import "dotenv/config";
import express from "express";
import { createServer } from "https";
import { OpenAI } from "openai";
import SocketIo, { Server } from "socket.io";
import { roomRouter } from "./routes/room";
var bodyParser = require("body-parser");
var cors = require("cors");
import { logger } from "./logger";
import {
    imageGeneration,
    imageGenerationSimulated,
    promptModeration,
} from "./services/imageGenerationService";
import { getCombinedTopicList } from "./services/topicService";
import { readFileSync } from "fs";
import { testRouter } from "./routes/tests";
import { userRouter } from "./routes/user";
import {
    attemptDecrementAccessKey,
    getCreditAmountForAccessKey,
    isAccessKeyValid,
} from "./services/accessKeyService";
import * as availableTopics from "./topics.json";
import { ImagesResponse } from "openai/resources";

const SERVER_MAX_PROMPT_CHARACTER_LIMIT = 300;
const SERVER_MAX_GUESS_CHARACTER_LIMIT = 300;

const MAX_DECREMENT_ACCESS_KEY_ATTEMPTS = 2

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const app = express();

// for POST
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

type RoomState = {
    roomID: string;
    state: "LOBBY" | "GAME" | "RESULTS" | "ERROR";
    creator: string;
    settings: RoomSettings;
    users: {
        userID: string;
        userAvatarSeed: string;
        username: string;
    }[];
    lobbyState: { availableTopics: TopicGroup[]; selectedTopics: string[] };
    gameState: { round: "PROMPTING" | "GUESSING" };
    resultState: {
        results: Result[];
        resultPlace: number;
        currentRevealer: string;
    };
    userGameState: GameStateUser;
};

interface ServerToClientEvents {
    roomstate_update: (roomstate: RoomState) => void;
}

interface ClientToServerEvents {
    "lobby:start_game": (
        message: string,
        callback: (result: { success: boolean; reason: string }) => void
    ) => void;
    "lobby:select_topic": (topic: string) => void;
    "lobby:remove_topic": (topic: string) => void;
    "lobby:setting:change_result_control": (setting: string) => void;
    "lobby:setting:change_round_count": (roundCount: number) => void;
    "lobby:setting:change_ai_model": (model: AIModel) => void;
    "game:submit_prompt": (
        prompt: string,
        callback: (result: { success: boolean; reason: string }) => void
    ) => void;
    "game:submit_guess": (
        guess: string,
        callback: (result: { success: boolean; reason: string }) => void
    ) => void;
    "result:next_result": (topic: string) => void;
}

interface InterServerEvents {}

interface SocketData {
    userID: string;
    roomID: string;
    userAvatarSeed: string;
    accessKey: string;
}

type GameSocket = SocketIo.Socket<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
>;

var privateKey = readFileSync("./cert/key.pem", "utf8");
var certificate = readFileSync("./cert/cert.pem", "utf8");

var credentials = { key: privateKey, cert: certificate };

const httpsServer = createServer(credentials, app);
const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
>(httpsServer, { cors: { origin: "*" } });
// if problem with websocket cors : https://www.youtube.com/watch?v=1BfCnjr_Vjg&t=392s
const PORT = process.env.PORT || 3000;

app.use(cors());

// TODO : use tokens auth to only allow 1 web socket connection per account
// TODO : need persistent storage for groups
// might get a away with in memory for active groups for now

// user router above middleware because we want the register endpoint to be open
// if more endpoints in user then change it
app.use(userRouter);
app.use(testRouter);

app.use(async (req, res, next) => {
    if (!req.headers.authorization) {
        console.log("no cred");
        return res.status(401).json({ error: "No credentials provided." });
    }

    // let isValid = await isAccessKeyValid(req.headers.authorization);
    let isValid = true;
    if (!isValid) {
        console.log(req.headers.authorization);
        return res.status(401).json({ error: "Un-authorized" });
    }

    next();
});

type AIModel = "dall-e-2" | "dall-e-3"

export interface RoomSettings {
    maxPlayer: number;
    nextResultPermission: "AUTHOR" | "HOST";
    roundCount: number;
    aiModel: AIModel
}

export interface TopicGroup {
    topic: string;
    itemCount: number;
}

interface ActiveRoomUser {
    userID: string;
    socket: SocketIo.Socket<
        ClientToServerEvents,
        ServerToClientEvents,
        InterServerEvents,
        SocketData
    >;
    gameState: GameStateUser;
    userAvatarSeed: string;
    initialCredits: number;
}

export interface GameStateUser {
    topics: string[];
    prompts: string[];
    imageURIsFromPrompts: string[];
    topicPlace: number;
    // to answer
    imagesToGuess: string[];
    guesses: string[];
    guessPlace: number;
}

export interface ActiveRoom {
    roomID: string;
    creator: string;
    users: ActiveRoomUser[];
    settings: RoomSettings;
    state: "LOBBY" | "GAME" | "RESULTS" | "ERROR";

    gameState: { round: "PROMPTING" | "GUESSING" };
    lobbyState: { availableTopics: TopicGroup[]; selectedTopics: string[] };
    resultState: {
        results: Result[];
        resultPlace: number;
        currentRevealer: string;
    };
}

// TODO : better random ID, or maybe db deals with this
function createRandomRoomID(): string {
    return "id" + Math.random().toString(16).slice(2);
}

function getRoomDefaultSettings(): RoomSettings {
    return {
        maxPlayer: 2,
        nextResultPermission: "HOST",
        roundCount: 2,
        aiModel:"dall-e-2"
    };
}

function getAvailableTopics(): TopicGroup[] {
    // using topic names find out the number of items in it
    let topics: TopicGroup[] = [];

    availableTopics.topicNames.forEach((topic) => {
        if (
            topic == "anime" ||
            topic == "movies" ||
            topic == "cartoons" ||
            topic == "shows" ||
            topic == "super heroes"
        ) {
            topics.push({
                topic: topic,
                itemCount: availableTopics[topic].length,
            });
        }
    });

    return topics;
}

app.post("/api/rooms/create", async (req, res) => {
    console.log("API_CALL:CREATE_ROOM")
    // TODO : probably should be caught my middleware
    if (!req.body.userID) {
        res.status(400).send(
            "Couldn't create room because request is missing UserID."
        );
        return;
    }

    if (typeof req.body.userID != "string") {
        res.status(400).send(
            "Couldn't create room because because UserID is not a string."
        );
        return;
    }

    if (!req.body.accessKey) {
        res.status(400).send(
            "Couldn't create room because request is a access key."
        );
        return;
    }

    if (typeof req.body.accessKey != "string") {
        res.status(400).send(
            "Couldn't create room because because accessKey is not a string."
        );
        return;
    }

    if(!(await isAccessKeyValid(req.body.accessKey))){
        res.status(400).send(
            "Couldn't create room because because accessKey is not valid."
        );
        return;
    }
    
    if(isAccessKeyAlreadyInUse(req.body.accessKey)){
        res.status(400).send(
            "Couldn't create room because because your accessKey is already in use."
        );
        return;
    }

    let roomID = createRandomRoomID();

    active_rooms.push({
        roomID: roomID,
        creator: req.body.userID,
        users: [],
        settings: getRoomDefaultSettings(),
        state: "LOBBY",
        gameState: { round: "PROMPTING" },
        lobbyState: {
            availableTopics: getAvailableTopics(),
            selectedTopics: [],
        },
        resultState: {
            results: [],
            resultPlace: 0,
            currentRevealer: "undefined",
        },
    });

    console.log("ROOM CREATED ------------------------------")

    if (true) {
        console.log("sending this");
        res.send({ roomID: roomID });
    } else {
        res.status(500).send(
            "Couldn't create room because something went wrong. Try again in a bit."
        );
    }
});

function getRoom(roomID: string): ActiveRoom | undefined {
    let room = active_rooms.find((element) => element.roomID == roomID);

    return room;
}

console.log("SERVER -- SERVER -- SERVER -- SERVER -- SERVER -- SERVER --");

let active_rooms: ActiveRoom[] = [];

// TODO : Implement isUserValid
function isUserValid(): boolean {
    return true;
}

function canUserJoinRoom(
    socket: SocketIo.Socket<
        ClientToServerEvents,
        ServerToClientEvents,
        InterServerEvents,
        SocketData
    >
): boolean {
    let room = getRoom(socket.data.roomID);

    if (room) {
        if (room.users.length > room.settings.maxPlayer) {
            logger.error("Can't join the room because it is full");
            return false;
        }
    }

    return true;
}

function isAccessKeyAlreadyInUse(accessKey : string) : boolean{
    let accessKeyInUse = active_rooms
    .map((room) =>
        room.users.map(
            (user) =>
                user.socket.data.accessKey ==
                accessKey
        )
    )
    .flat()
    .includes(true);

    return accessKeyInUse
}

// Middleware, for initial socket connection
// TODO : check all user data from handshake here before user actually connects, because socket.data will be set there
io.use(async (socket, next) => {
    // Check roomID
    if (typeof socket.handshake.query.roomID != "string") {
        next(new Error("Can't join, roomID is in wrong format."));
        return;
    }

    if (getRoom(socket.handshake.query.roomID) == undefined) {
        next(new Error("Can't join room because it doesn't exist."));
        return;
    }

    // Check access key

    if (typeof socket.handshake.query.accessKey != "string") {
        next(new Error("Can't join, accessKey is incorrect."));
        return;
    }

    let isValid = await isAccessKeyValid(socket.handshake.query.accessKey);
    if (!isValid) {
        next(new Error("Can't join, accessKey is not valid."));
        return;
    }
    
    // Access key can't be used twice
    // TODO : what if access key gets stuck in a room for some reason, probably won't but possible in some way
    if (isAccessKeyAlreadyInUse(socket.handshake.query.accessKey)) {
        next(new Error("Can't join, your accessKey is already in use."));
        return;
    }

    // Check userID

    // TODO : these already check for undefined, shouldn't need the code above
    if (typeof socket.handshake.query.userID != "string") {
        next(new Error("Can't join, userID is in wrong format."));
        return;
    }

    // need to make sure because userID is sometimes split using @
    if (socket.handshake.query.userID.replace(/[^@]/g, "").length > 1) {
        next(new Error("Can't join because userID contains illegal character"));
    }

    // Check avatar seed

    if (typeof socket.handshake.query.userAvatarSeed != "string") {
        next(new Error("Can't join, userAvatarSeed is in wrong format."));
        return;
    }

    // Set user data
    socket.data.userID = socket.handshake.query.userID;
    socket.data.roomID = socket.handshake.query.roomID;
    socket.data.userAvatarSeed = socket.handshake.query.userAvatarSeed;
    socket.data.accessKey = socket.handshake.query.accessKey;

    if (!isUserValid()) {
        next(new Error("Can't join room, authentication error."));
    }

    if (!canUserJoinRoom(socket)) {
        next(new Error("Can't join room."));
    }

    next();
});

function createInitialUserGameState(): GameStateUser {
    return {
        topics: [],
        prompts: [],
        imageURIsFromPrompts: [],
        topicPlace: 0,
        imagesToGuess: [],
        guesses: [],
        guessPlace: 0,
    };
}

async function addUserToRoom(socket: GameSocket) {
    let creditAmountForAccessKey = await getCreditAmountForAccessKey(
        socket.data.accessKey
    );

    if (creditAmountForAccessKey == null) {
        logger.error(
            "Can't add user to room, because access key data doesn't exist."
        );
        return;
    }

    // let addedUser = addUserToRoom(
    //     socket.data.roomID,
    //     socket.data.userID,
    //     socket,
    //     createInitialUserGameState(),
    //     socket.data.userAvatarSeed,
    //     creditAmountForAccessKey
    // );

    let room = getRoom(socket.data.roomID);

    if (room == undefined) {
        return false;
    }

    room.users.push({
        userID: socket.data.userID,
        socket: socket,
        gameState: createInitialUserGameState(),
        userAvatarSeed: socket.data.userAvatarSeed,
        initialCredits: creditAmountForAccessKey,
    });

    // if (!addedUser) {
    //     logger.error(
    //         "Can't add user to group, because group no longer exists."
    //     );
    //     return;
    // }

    // updateActiveGroupUsersChanged(socket);
}

const updateUserAboutRoomState = (
    user: ActiveRoomUser,
    userRoom: ActiveRoom,
    userList: { userID: string; userAvatarSeed: string; username: string }[]
) => {
    user.socket.emit("roomstate_update", {
        roomID: userRoom.roomID,
        state: userRoom.state,
        users: userList,
        creator: userRoom.creator,
        settings: userRoom.settings,
        lobbyState: {
            availableTopics: userRoom.lobbyState.availableTopics,
            selectedTopics: userRoom.lobbyState.selectedTopics,
        },
        gameState: {
            round: userRoom.gameState.round,
        },
        resultState: {
            results: userRoom.resultState.results,
            resultPlace: userRoom.resultState.resultPlace,
            currentRevealer: userRoom.resultState.currentRevealer,
        },
        userGameState: user.gameState,
    });
};

const createUserList = (room: ActiveRoom) => {
    return room.users.map((x) => ({
        userID: x.userID,
        userAvatarSeed: x.userAvatarSeed,
        username: x.userID.split("@")[0],
        credits:x.initialCredits
    }));
};
const updateUsersAboutRoomState = (roomID: string) => {
    const room = getRoom(roomID);

    if (room == undefined) {
        // TODO : shiii
        return;
    }

    const userList = createUserList(room);

    room.users.forEach((user) => {
        updateUserAboutRoomState(user, room!, userList);
    });
};

const getCostForModel = (model:string) => {
    switch (model) {
        case "dall-e-3":
          return 2.5;
        case "dall-e-2":
          return 1;
        default:
          return 1;
      }
}

const SERVER_MAX_PLAYERS_CHARADES = 2;

io.on("connect", async (socket) => {
    logger.info(`Socket : ${socket.id} has connected.`);

    const room = getRoom(socket.data.roomID);
    if (!room) return;

    await addUserToRoom(socket);
    updateUsersAboutRoomState(socket.data.roomID);

    socket.on("lobby:select_topic", (topic: string) => {
        let room = getRoom(socket.data.roomID);

        if (!room) {
            // emitRoomErrorToUser(
            //     socket,
            //     "Can't select a topic, room doesn't exist.",
            //     "ERROR"
            // );
            return;
        }

        if (room.lobbyState.selectedTopics.includes(topic)) return;

        room.lobbyState.selectedTopics.push(topic);
        updateUsersAboutRoomState(socket.data.roomID);
    });

    socket.on("lobby:remove_topic", (topic: string) => {
        let room = getRoom(socket.data.roomID);

        if (!room) {
            // emitRoomErrorToUser(
            //     socket,
            //     "Can't remove a topic, room doesn't exist.",
            //     "ERROR"
            // );
            return;
        }

        if (!room.lobbyState.selectedTopics.includes(topic)) {
            return;
        }

        room.lobbyState.selectedTopics = room.lobbyState.selectedTopics.filter(
            (item) => item != topic
        );

        updateUsersAboutRoomState(socket.data.roomID);
    });

    socket.on("lobby:setting:change_result_control", (setting: string) => {
        // TODO : why? just define a type
        if (setting != "HOST" && setting != "AUTHOR") {
            return;
        }

        let room = getRoom(socket.data.roomID);

        if (!room) {
            // emitRoomErrorToUser(
            //     socket,
            //     "Can't remove a topic, room doesn't exist.",
            //     "ERROR"
            // );
            return;
        }

        if (room.settings.nextResultPermission == setting) return;

        room.settings.nextResultPermission = setting;

        updateUsersAboutRoomState(socket.data.roomID);
    });

    socket.on("lobby:setting:change_round_count", (roundCount: number) => {
        if (!(roundCount % 2 == 0) || roundCount > 12) {
            // emitRoomErrorToUser(
            //     socket,
            //     "Can't change round count to provided value.",
            //     "WARNING"
            // );
            return;
        }

        let room = getRoom(socket.data.roomID);

        if (!room) {
            // emitRoomErrorToUser(
            //     socket,
            //     "Can't change round count, room doesn't exist.",
            //     "ERROR"
            // );
            return;
        }

        room.settings.roundCount = roundCount;

        updateUsersAboutRoomState(socket.data.roomID);
    });

    socket.on("lobby:setting:change_ai_model", (model: AIModel) => {
        let room = getRoom(socket.data.roomID);

        if (!room) {
            // emitRoomErrorToUser(
            //     socket,
            //     "Can't remove a topic, room doesn't exist.",
            //     "ERROR"
            // );
            return;
        }

        if (room.settings.aiModel == model) return;

        room.settings.aiModel = model;

        updateUsersAboutRoomState(socket.data.roomID);
    });

    socket.on("lobby:start_game", (_, callback) => {
        let room = getRoom(socket.data.roomID);

        // TODO : This is a major error so therefore should be handled by separate thing that
        //        will close the room on the client
        if (room == undefined) {
            // emitRoomErrorToUser(
            //     socket,
            //     "Can't start game, room doesn't exist.",
            //     "ERROR"
            // );
            return;
        }

        // TODO : for testing
        // room.settings.roundCount = 1

        if (
            room.users.length < room.settings.maxPlayer &&
            room.users.length <
            SERVER_MAX_PLAYERS_CHARADES - 1
        ) {
            callback({
                success: false,
                reason: "Not enough players to start.",
            });

            return;
        }

        if (room.lobbyState.selectedTopics.length == 0) {
            callback({ success: false, reason: "Not enough topics to start." });

            return;
        }

        let topicList = getCombinedTopicList(room.lobbyState.selectedTopics);

        // If there is not enough topics, in the topic groups that were selected, for users in the game then don't start
        if (room.settings.roundCount * room.users.length > topicList.length) {
            callback({
                success: false,
                reason: "Not enough topics to start, select a few more.",
            });

            return;
        }

        // TODO : check which users don't have credits, and let the users know who doesn't
        // Check if all users have enough credits for the amount of rounds of topics chosen
        let enoughCredits = !room.users
            .map(
                (roomUser) =>
                    roomUser.initialCredits > room!.settings.roundCount * room!.lobbyState.selectedTopics.length
            )
            .includes(false);

        if (!enoughCredits) {
            callback({
                success: false,
                reason: "Not enough credits to start, pick less rounds or less topics.",
            });

            return;
        }

        // If made it here then we can actually start the game

        // Assign each player a slice of the randomised topic list
        // A slice is the round count
        room.users.forEach((user, index) => {
            user.gameState.topics = topicList.slice(
                index * room!.settings.roundCount,
                (index + 1) * room!.settings.roundCount
            );
        });

        callback({ success: true, reason: "" });

        // Update game state to the first round
        room.state = "GAME";
        updateUsersAboutRoomState(room.roomID);
    });

    socket.on("game:submit_prompt", async (prompt, callback) => {
        // Prompt Checks

        if (prompt.length <= 0) {
            callback({
                success: false,
                reason: "Can't accept a empty prompt.",
            });
            return;
        }

        if (prompt.length > SERVER_MAX_PROMPT_CHARACTER_LIMIT) {
            callback({ success: false, reason: "The prompt is too long." });
            return;
        }

        let room = getRoom(socket.data.roomID);

        if (room == undefined) {
            // emitRoomErrorToUser(
            //     socket,
            //     "Can't submit a prompt, group doesn't exist.",
            //     "ERROR"
            // );
            return;
        }

        let user = room.users.find((item) => item.userID == socket.data.userID);

        // shouldn't happen but just in case
        if (user == undefined) {
            // logger.error("Couldn't submit a prompt, user doesn't exist.");
            return;
        }

        // TODO : using any here
        // const moderationResult: any = await promptModeration(prompt);
        // if (moderationResult == undefined) {
        //     callback({success:false, reason:"Something went wrong, please try again."})
        //     return;
        // }

        // if (moderationResult.results[0].flagged) {

        //     // TODO : the reason should only contain the values flagged
        //     // No success if the prompt has been flagged
        //     callback({
        //         success: !moderationResult.results.flagged,
        //         // reason: moderationResult.results.categories,
        //         reason: "Your prompt contains inappropriate content."
        //     });
        //     return;
        // }

        // Save Prompt

        user.gameState.prompts.push(prompt);
        user.gameState.topicPlace += 1;
        // Tell user prompt submitted successfully
        callback({ success: true, reason: "" });

        // TODO : not sure if DALLE fails requests, will have to check
        // TODO : I could ensure that the access key has enough credits before calling image generation
        imageGeneration(room.settings.aiModel, prompt).then(async (res) => {
            // TODO : should do checks on the data

            if (room == undefined) {
                // TODO : Major error, but if room exists then it won't have users, so won't affect them
                // bail just in case the room doesn't exist anymore after waiting for promise
                return;
            }

            // Check if user still exists
            if (user == undefined) {
                // If not bail early, no need to call callback for user that has left
                return;
            }

            // If failed to decrement the access key then terminate the game so our key doesn't get abused
            if(!(await attemptDecrementAccessKey(socket.data.accessKey, getCostForModel(room.settings.aiModel), MAX_DECREMENT_ACCESS_KEY_ATTEMPTS))){
                room.state = "ERROR";
                // TODO : maybe add error message to error
                updateUsersAboutRoomState(room.roomID)
                return;
            };
            

            if(!res){
                return;
            }

            if(res.data.length == 0){
                return;
            }

            if(res.data[0].url == undefined){
                return;
            }

            // Save imageURI for that prompt
            user.gameState.imageURIsFromPrompts.push(res.data[0].url);

            // Check if prompting stage is finished
            // Do this by checking if all users have the same amount of imageURIs as topics

            if (room!.users.length < room!.settings.maxPlayer) {
                // TODO : Major error, need to deal with this here because even if player leaves and we
                // show error to user this still could execute
                callback({
                    success: false,
                    reason: "Major issue, other player left.",
                });
                return;
            }

            let everyoneFinished = true;
            room!.users.forEach((roomUser) => {
                if (
                    roomUser.gameState.imageURIsFromPrompts.length !=
                    roomUser.gameState.topics.length
                ) {
                    everyoneFinished = false;
                }
            });

            if (everyoneFinished) {
                room.gameState.round = "GUESSING";

                // Give user1 the generated images from user2, and vice versa
                room.users[0].gameState.imagesToGuess =
                    room.users[1].gameState.imageURIsFromPrompts;
                room.users[1].gameState.imagesToGuess =
                    room.users[0].gameState.imageURIsFromPrompts;

                updateUsersAboutRoomState(room.roomID);
            }
        });

        updateUserAboutRoomState(user, room, createUserList(room));
    });

    socket.on("game:submit_guess", (guess, callback) => {
        // Guess checks

        if (guess.length <= 0) {
            callback({
                success: false,
                reason: "Can't accept a empty guess.",
            });
            return;
        }

        if (guess.length > SERVER_MAX_GUESS_CHARACTER_LIMIT) {
            callback({ success: false, reason: "The guess is too long." });
            return;
        }

        let room = getRoom(socket.data.roomID);

        // TODO : major error
        if (room == undefined) {
            // emitRoomErrorToUser(
            //     socket,
            //     "Can't submit guess, group doesn't exist.",
            //     "ERROR"
            // );
            return;
        }

        let user = room.users.find((item) => item.userID == socket.data.userID);

        // TODO : major error
        if (user == undefined) {
            // logger.error(
            //     "Couldn't submit guess, user does not exist in the room."
            // );
            return;
        }

        // Save the guess
        user.gameState.guesses.push(guess);
        user.gameState.guessPlace += 1;

        callback({ success: true, reason: "" });

        // Check if all users are finished
        // Check all users, if they have not went through their entire topics array then not everyone finished yet
        let everyoneFinished = true;
        room.users.forEach((roomUser) => {
            if (
                roomUser.gameState.guessPlace <
                roomUser.gameState.imagesToGuess.length
            ) {
                everyoneFinished = false;
            }
        });

        if (everyoneFinished) {
            room.state = "RESULTS";

            // Set initial state for results
            room.resultState.results = getResultsOfGame(room);
            room.resultState.resultPlace = 0;

            if (room.settings.nextResultPermission == "AUTHOR") {
                room.resultState.currentRevealer =
                    room.resultState.results[0].prompter.userID;
            } else {
                room.resultState.currentRevealer = room.creator;
            }

            updateUsersAboutRoomState(room.roomID);
        } else {
            updateUserAboutRoomState(user, room, createUserList(room));
        }
    });

    socket.on("result:next_result", () => {
        let room = getRoom(socket.data.roomID);

        // TODO : major error
        if (room == undefined) {
            // emitRoomErrorToUser(
            //     socket,
            //     "Can't submit guess, group doesn't exist.",
            //     "ERROR"
            // );
            return;
        }

        if (socket.data.userID != room.resultState.currentRevealer) {
            return;
        }

        if (
            room.resultState.resultPlace + 1 >=
            room.resultState.results.length
        ) {
            return;
        }

        room.resultState.resultPlace += 1;
        room.resultState.currentRevealer =
            room.resultState.results[
                room.resultState.resultPlace
            ].prompter.userID;

        updateUsersAboutRoomState(room.roomID);
    });

    socket.on("disconnect", () => {
        // logger.info(`Socket : ${socket.id} has disconnected.`);
        let room = getRoom(socket.data.roomID);

        if (room == undefined) {
            // logger.error(
            //     "The group the disconnected socket was in no longer exists."
            // );
            return;
        }

        // Remove user from room, and remove room if empty

        // remove user from room
        room.users = room.users.filter(
            (item) => item.userID != socket.data.userID
        );

        // Remove the room if no users
        if (room.users.length == 0) {
            active_rooms.filter(
                (activeRoom) => activeRoom.roomID != room!.roomID
            );
            return;
        }

        // If there is another player then make them the host
        if (room.users.length == 1) {
            // Change host to last player
            room.creator = room.users[0].userID;

            // Change result control to host
            room.settings.nextResultPermission = "HOST";
            room.resultState.currentRevealer = room.users[0].userID;
        }

        if (room.state == "GAME") {
            // TODO : THROW ERROR FOR NOW
            // can't continue rn
            room.state = "ERROR";
        }

        updateUsersAboutRoomState(socket.data.roomID);
    });
});

type Result = {
    topic: string;
    prompt: string;
    guess: string;
    imageURI: string;
    prompter: { userID: string; userAvatarSeed: string; username: string };
    guesser: { userID: string; userAvatarSeed: string; username: string };
};

// TODO : will not work fore more than one user, whole system would need to be redesigned for that
function getResultsOfGame(room: ActiveRoom): Result[] {
    let results = [];

    if (room.users.length < 2) {
        logger.error("Can't get results of the game, players missing.");
        return [];
    }

    let user = room.users[0];
    let otherUser = room.users[1];

    for (let i = 0; i < user.gameState.topics.length; i++) {
        results.push({
            topic: user.gameState.topics[i],
            prompt: user.gameState.prompts[i],
            imageURI: user.gameState.imageURIsFromPrompts[i],
            prompter: {
                userID: user.userID,
                username: user.userID.split("@")[0],
                userAvatarSeed: user.userAvatarSeed,
            },
            guesser: {
                userID: otherUser.userID,
                username: otherUser.userID.split("@")[0],
                userAvatarSeed: otherUser.userAvatarSeed,
            },
            guess: otherUser.gameState.guesses[i],
        });

        results.push({
            topic: otherUser.gameState.topics[i],
            prompt: otherUser.gameState.prompts[i],
            imageURI: otherUser.gameState.imageURIsFromPrompts[i],
            prompter: {
                userID: otherUser.userID,
                username: otherUser.userID.split("@")[0],
                userAvatarSeed: otherUser.userAvatarSeed,
            },
            guesser: {
                userID: user.userID,
                username: user.userID.split("@")[0],
                userAvatarSeed: user.userAvatarSeed,
            },
            guess: user.gameState.guesses[i],
        });
    }

    return results;
}

httpsServer.listen(PORT, () => {
    logger.info(`Server running on port: ${PORT}`);
});
