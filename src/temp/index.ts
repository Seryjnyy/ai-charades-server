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
    imageGenerationSimulated,
    promptModeration,
} from "./services/imageGenerationService";
import { getCombinedTopicList } from "./services/topicService";
import { addUserToRoom, getRoom } from "./services/activeRoomService";
import { readFileSync } from "fs";
import { testRouter } from "./routes/tests";
import { userRouter } from "./routes/user";
import {
    decrementAccessKey,
    getCreditAmountForAccessKey,
    isAccessKeyValid,
} from "./services/accessKeyService";

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const app = express();

// for POST
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// TODO : for some reason it does not care for any other emit we do
// it only cares for this one, could add the rest but idk if there is to it
interface ServerToClientEvents {
    room_state_update: (roomState: {
        roomState: {
            availableTopics: TopicGroup[];
            creator: string;
            settings: RoomSettings;
        };
    }) => void;
    "room:topic_update": (selectedTopics: string[]) => void;
    "room:warning": (message: string) => void;
    "room:error": (message: string) => void;
    results: (results: { results: Result[]; resultPlace: number }) => void;
    game_state_update: (gameState: {
        gameState: GameState;
        ourState: GameStateUser;
    }) => void;
    game_start: (initialGameState: {
        gameState: GameState;
        ourState: GameStateUser;
    }) => void;
    user_change: (
        users: {
            userID: string;
            userAvatarSeed: string;
            username: string;
        }[]
    ) => void;
    "results:next": (resultState: { resultPlace: number }) => void;
}

interface ClientToServerEvents {
    start_game: () => void;
    submit_guess: (message: { guess: string }) => void;
    submit_prompt: (
        message: { prompt: string },
        callback: (an: { flagged: boolean; reason: any } | undefined) => void
    ) => Promise<void>;
    "room:select_topic": (topic: string) => void;
    "room:remove_topic": (topic: string) => void;
    "results:next": () => void;
    "room:nextResultPermission": (setting: string) => void;
    "room:changeRoundCount": (count: number) => void;
}

interface InterServerEvents {}

interface SocketData {
    userID: string;
    roomID: string;
    userAvatarSeed: string;
    accessKey: string;
}

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

// TODO : group should be named room, or something uniform
// TODO : use tokens auth to only allow 1 web socket connection per account
// TODO : need persistent storage for groups
// might get a away with in memory for active groups for now

// user router above middleware because we want the register endpoint to be open
// if more endpoints in user then change it
app.use(userRouter);
app.use(testRouter);

app.use(async (req, res, next) => {
    if (!req.headers.authorization) {
        return res.status(401).json({ error: "No credentials provided." });
    }

    let isValid = await isAccessKeyValid(req.headers.authorization);
    if (!isValid) {
        return res.status(401).json({ error: "Un-authorized" });
    }

    next();
});

app.use(roomRouter);

export enum Rounds {
    Lobby = "LOBBY",
    Prompting = "PROMPTING",
    Guessing = "GUESSING",
    Results = "RESULTS",
    ErrorAPlayerLeft = "ERROR:A_PLAYER_LEFT",
}

export interface GameState {
    round: Rounds;
}
// TODO : could do better with naming
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

export interface TopicGroup {
    topic: string;
    itemsInTopic: number;
}

export interface ActiveRoom {
    groupID: string;
    users: ActiveRoomUser[];
    settings: RoomSettings;
    creator: string;
    gameState: GameState;
    resultState: { resultPlace: number };
    availableTopics: TopicGroup[];
}

export interface RoomSettings {
    maxPlayer: number;
    nextResultPermission: string;
    roundCount: number;
    selectedTopics: string[];
}

interface Room {
    roomID: string;
    creator: string;
    settings: RoomSettings;
}

export var temp_rooms: Room[] = [];

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

// TODO : this should be part of game state or maybe a separate lobby room state im not sure
// TODO : add return bool to let the caller know if success
// if it failed then it can decide if to ask user to retry or maybe stop the room
function updateActiveGroupUsersChanged(
    socket: SocketIo.Socket<
        ClientToServerEvents,
        ServerToClientEvents,
        InterServerEvents,
        SocketData
    >
) {
    let group = getRoom(socket.data.roomID);

    if (group == undefined) {
        logger.error(
            "Can't update group about users, because group doesn't exist."
        );

        return;
    }

    let userList = group.users.map((x) => ({
        userID: x.userID,
        userAvatarSeed: x.userAvatarSeed,
        username: x.userID.split("@")[0],
    }));

    group.users.forEach((user) => {
        user.socket.emit("user_change", userList);
    });
}

async function addUserToGroup(
    socket: SocketIo.Socket<
        ClientToServerEvents,
        ServerToClientEvents,
        InterServerEvents,
        SocketData
    >
) {
    let creditAmountForAccessKey = await getCreditAmountForAccessKey(
        socket.data.accessKey
    );
    if (creditAmountForAccessKey == null) {
        logger.error(
            "Can't add user to group, because access key data doesn't exist."
        );
        return;
    }

    let addedUser = addUserToRoom(
        socket.data.roomID,
        socket.data.userID,
        socket,
        createInitialUserGameState(),
        socket.data.userAvatarSeed,
        creditAmountForAccessKey
    );

    if (!addedUser) {
        logger.error(
            "Can't add user to group, because group no longer exists."
        );
        return;
    }

    updateActiveGroupUsersChanged(socket);
}

interface Result {
    topic: string;
    prompt: string;
    guess: string;
    imageURI: string;
    originatorID: string; // userID
}

// TODO : will not work fore more than one user, whole system would need to be redesigned for that
function getResultsOfGame(group: ActiveRoom): Result[] {
    let results = [];

    if (group.users.length < 2) {
        logger.error("Can't get results of the game, players missing.");
        return [];
    }

    let user = group.users[0];
    let otherUser = group.users[1];

    for (let i = 0; i < user.gameState.topics.length; i++) {
        results.push({
            topic: user.gameState.topics[i],
            prompt: user.gameState.prompts[i],
            imageURI: user.gameState.imageURIsFromPrompts[i],
            originatorID: user.userID,
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
            originatorID: otherUser.userID,
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

// TODO : implement this
// probably using a token system
// check token and if belongs to this room

function isUserValid(): boolean {
    return true;
}

function canUserJoinGroup(
    socket: SocketIo.Socket<
        ClientToServerEvents,
        ServerToClientEvents,
        InterServerEvents,
        SocketData
    >
): boolean {
    let group = getRoom(socket.data.roomID);

    // TODO : commented out for now because I don't know how to solve this issue.
    // client connects through socket in useEffect, but in dev useEffect renders twice
    // so 2 connection attempts are made for the same client.
    // Even providing a clean up function, socket.disconnect, it still happens because the 2nd connection is faster than the clean up
    // NVM, but if there is issue with this, this might be it
    if (group) {
        if (group.users.length > group.settings.maxPlayer) {
            logger.error("Can't join the group because room is full");
            return false;
        }
    }

    return true;
}

console.log("SERVER -- SERVER -- SERVER -- SERVER -- SERVER -- SERVER --");

// Middleware, for initial socket connection
// TODO : check all user data from handshake here before user actually connects, because socket.data will be set there
io.use(async (socket, next) => {
    // TODO : User can only have one room
    // returns used to satisfy TS
    if (typeof socket.handshake.query.accessKey != "string") {
        next(new Error("Can't join, accessKey is incorrect."));
        return;
    }

    let isValid = await isAccessKeyValid(socket.handshake.query.accessKey);
    if (!isValid) {
        next(new Error("Can't join, accessKey is not valid."));
        return;
    }
    // TODO : check if in any of the active rooms there is a user using the same access key
    let accessKeyInUse = active_rooms
        .map((room) =>
            room.users.map(
                (user) =>
                    user.socket.data.accessKey ==
                    socket.handshake.query.accessKey
            )
        )
        .flat()
        .includes(true);

    if (accessKeyInUse) {
        next(new Error("Can't join, accessKey is already in use."));
        return;
    }

    // TODO : these already check for undefined, shouldn't need the code above
    if (typeof socket.handshake.query.userID != "string") {
        next(new Error("Can't join, userID is in wrong format."));
        return;
    }

    if (typeof socket.handshake.query.groupID != "string") {
        next(new Error("Can't join, groupID is in wrong format."));
        return;
    }

    if (typeof socket.handshake.query.userAvatarSeed != "string") {
        next(new Error("Can't join, userAvatarSeed is in wrong format."));
        return;
    }

    // need to make sure because userID is sometimes split using @
    if (socket.handshake.query.userID.replace(/[^@]/g, "").length > 1) {
        next(new Error("Can't join because userID contains illegal character"));
    }

    // TODO : maybe check for avatar seed too
    // Set user data
    socket.data.userID = socket.handshake.query.userID;
    socket.data.roomID = socket.handshake.query.groupID;
    socket.data.userAvatarSeed = socket.handshake.query.userAvatarSeed;
    socket.data.accessKey = socket.handshake.query.accessKey;

    if (getRoom(socket.data.roomID) == undefined) {
        next(new Error("Can't join room, it doesn't exist."));
    }

    if (!isUserValid()) {
        next(new Error("Can't join room, authentication error."));
    }

    if (!canUserJoinGroup(socket)) {
        next(new Error("Can't join room."));
    }

    next();
});

export var active_rooms: ActiveRoom[] = [];

function emitRoomErrorToUser(
    socket: SocketIo.Socket<
        ClientToServerEvents,
        ServerToClientEvents,
        InterServerEvents,
        SocketData
    >,
    message: string,
    severity: "WARNING" | "ERROR"
) {
    // TODO : only named like this incase we want to have a severe error too
    // a warning should only let the user know about the error
    // a serious error would stop the room
    if (severity == "ERROR") {
        logger.error(message);
        socket.emit("room:error", message);
    } else if (severity == "WARNING") {
        logger.warn(message);
        socket.emit("room:warning", message);
    }
}

io.on("connect", async (socket) => {
    logger.info(`Socket : ${socket.id} has connected.`);

    // socket middleware
    socket.use((packet, next) => {
        const [eventName, eventData] = packet;

        logger.info({
            eventName: eventName,
            eventData: eventData,
            socketID: socket.id,
        });

        next();
    });

    await addUserToGroup(socket);

    let group = getRoom(socket.data.roomID);
    if (group == undefined) {
        emitRoomErrorToUser(
            socket,
            "Can't connect, room doesn't exist.",
            "ERROR"
        );
        return;
    }

    socket.on("room:nextResultPermission", (setting) => {
        if (setting != "host" && setting != "author") {
            emitRoomErrorToUser(
                socket,
                "Can't change this setting, incorrect value.",
                "WARNING"
            );
            console.log("setting wrong:" + setting);
            return;
        }

        let room = getRoom(socket.data.roomID);

        if (room == undefined) {
            emitRoomErrorToUser(
                socket,
                "Can't change this setting, room is missing.",
                "ERROR"
            );
            console.log("room2222");
            return;
        }

        if (room.settings.nextResultPermission == setting) {
            console.log("here2222222222");
            return;
        }

        room.settings.nextResultPermission = setting;

        room.users.forEach((groupUser) => {
            groupUser.socket.emit("room_state_update", {
                roomState: {
                    availableTopics: room!.availableTopics,
                    creator: room!.creator,
                    settings: room!.settings,
                },
            });
        });
    });

    // let user know what topics are selected with this initial emit to them
    socket.emit("room:topic_update", group!.settings.selectedTopics);

    socket.emit("room_state_update", {
        roomState: {
            availableTopics: group.availableTopics,
            creator: group.creator,
            settings: group.settings,
        },
    });

    socket.on("start_game", () => {
        let group = getRoom(socket.data.roomID);

        if (group == undefined) {
            emitRoomErrorToUser(
                socket,
                "Can't start game, room doesn't exist.",
                "ERROR"
            );
            return;
        }

        // TODO : group.settings.maxPlayer does nothing
        if (group.users.length < 2) {
            emitRoomErrorToUser(
                socket,
                "Can't start game, not enough players.",
                "WARNING"
            );

            return;
        }

        // START CREATING PROMPTS STAGE

        if (group.settings.selectedTopics.length == 0) {
            emitRoomErrorToUser(
                socket,
                "Can't start game, pick some topics.",
                "WARNING"
            );

            return;
        }

        // check if all users have enough credits for the amount of rounds of topics chosen
        let enoughCredits = !group.users
            .map(
                (groupUser) =>
                    groupUser.initialCredits > group!.settings.roundCount
            )
            .includes(false);

        if (!enoughCredits) {
            group.users.forEach((groupUser) => {
                emitRoomErrorToUser(
                    groupUser.socket,
                    "Can't start not enough credits",
                    "WARNING"
                );
            });
            return;
        }

        // set initial topics for both users

        // TODO : this is round amount, that the user should set, and we should get it from group.settings

        let topicList = getCombinedTopicList(group.settings.selectedTopics);

        // If there is not enough topics, in the topic groups that were selected, for users in the game then don't start
        if (
            group!.settings.roundCount * group.users.length >
            topicList.length
        ) {
            emitRoomErrorToUser(
                socket,
                "Can't start game, pick more topics.",
                "WARNING"
            );

            return;
        }

        group.users.forEach((user, index) => {
            user.gameState.topics = topicList.slice(
                index * group!.settings.roundCount,
                (index + 1) * group!.settings.roundCount
            );
        });

        // Update game state to the first round
        group.gameState.round = Rounds.Prompting;

        group.users.forEach((user) => {
            user.socket.emit("game_start", {
                gameState: group!.gameState,
                ourState: user.gameState,
            });
        });
    });

    socket.on("submit_guess", (message) => {
        let group = getRoom(socket.data.roomID);

        if (group == undefined) {
            emitRoomErrorToUser(
                socket,
                "Can't submit guess, group doesn't exist.",
                "ERROR"
            );
            return;
        }

        // Get user
        let user = group.users.find(
            (item) => item.userID == socket.data.userID
        );

        if (user == undefined) {
            logger.error(
                "Couldn't submit guess, user does not exist in the room."
            );
            return;
        }

        // Save the guess
        user.gameState.guesses.push(message.guess);
        user.gameState.guessPlace += 1;

        // Check if all users are finished
        // Check all users, if they have not went through their entire topics array then not everyone finished yet
        let everyoneFinished = true;
        group.users.forEach((groupUser) => {
            if (
                groupUser.gameState.guessPlace <
                groupUser.gameState.imagesToGuess.length
            ) {
                everyoneFinished = false;
            }
        });

        if (everyoneFinished) {
            group.gameState.round = Rounds.Results;

            group.users.forEach((groupUser) => {
                groupUser.socket.emit("game_state_update", {
                    gameState: group!.gameState,
                    ourState: groupUser.gameState,
                });
            });

            // get results for group

            // combine everything
            group.users.forEach((groupUser) => {
                groupUser.socket.emit("results", {
                    results: getResultsOfGame(group!),
                    resultPlace: 0,
                });
            });
        } else {
            user.socket.emit("game_state_update", {
                gameState: group.gameState,
                ourState: user.gameState,
            });
        }
    });

    socket.on("results:next", () => {
        let room = getRoom(socket.data.roomID);

        if (room == undefined) {
            // TODO : should emit to all users
            emitRoomErrorToUser(
                socket,
                "Can't get next result, room doesn't exist.",
                "ERROR"
            );
            return;
        }

        room.resultState.resultPlace += 1;

        // TODO : can't check if resultPlace might be out of bounds, results are sent separately
        // if(room.resultState.resultPlace > room.)

        room.users.forEach((roomUser) =>
            roomUser.socket.emit("results:next", {
                resultPlace: room!.resultState.resultPlace,
            })
        );
    });

    socket.on("submit_prompt", async (message, callback) => {
        // TODO : check the user provided prompt just incase, for example length.

        let group = getRoom(socket.data.roomID);

        if (group == undefined) {
            emitRoomErrorToUser(
                socket,
                "Can't submit a prompt, group doesn't exist.",
                "ERROR"
            );
            return;
        }

        // Get user
        let user = group.users.find(
            (item) => item.userID == socket.data.userID
        );

        // shouldn't happen but just in case
        if (user == undefined) {
            logger.error("Couldn't submit a prompt, user doesn't exist.");
            return;
        }

        // TODO : using any here
        // const moderationResult: any = await promptModeration(message.prompt);
        // if (promptModeration == undefined) {
        //     // TODO : deal with this
        // }

        // if (moderationResult.results[0].flagged) {
        //     // let user know that can't accept prompt, need to change it
        //     // TODO : the reason should only contain the values flagged
        //     callback({
        //         flagged: moderationResult.results.flagged,
        //         reason: moderationResult.results.categories,
        //     });
        //     return;
        // }

        // Save prompt
        // TODO : should do some checks before
        user.gameState.prompts.push(message.prompt);
        user.gameState.topicPlace += 1;

        // TODO : not sure if DALLE fails requests, will have to check
        // TODO : I could ensure that the access key has enough credits before calling image generation
        imageGenerationSimulated(message.prompt, 1, "256x256").then((res) => {
            // TODO : should do checks on the data

            decrementAccessKey(socket.data.accessKey);

            user!.gameState.imageURIsFromPrompts.push(res);

            if (group!.users.length < 2) {
                return;
            }

            // Check all users, if they have not went through their entire topics array then not everyone finished yet
            let everyoneFinished = true;
            group!.users.forEach((groupUser) => {
                if (
                    groupUser.gameState.imageURIsFromPrompts.length !=
                    groupUser.gameState.topics.length
                ) {
                    everyoneFinished = false;
                }
            });

            if (everyoneFinished) {
                group!.gameState.round = Rounds.Guessing;

                // Give user1 the generated images from user2, and vice versa
                group!.users[0].gameState.imagesToGuess =
                    group!.users[1].gameState.imageURIsFromPrompts;
                group!.users[1].gameState.imagesToGuess =
                    group!.users[0].gameState.imageURIsFromPrompts;

                group!.users.forEach((user) => {
                    user.socket.emit("game_state_update", {
                        gameState: group!.gameState,
                        ourState: user.gameState,
                    });
                });
            }
        });

        // let user know no problems
        callback(undefined);

        user.socket.emit("game_state_update", {
            gameState: group.gameState,
            ourState: user.gameState,
        });
    });

    socket.on("room:select_topic", (topic: string) => {
        let group = getRoom(socket.data.roomID);

        if (!group) {
            emitRoomErrorToUser(
                socket,
                "Can't select a topic, room doesn't exist.",
                "ERROR"
            );
            return;
        }

        group.settings.selectedTopics.push(topic);

        group.users.forEach((user) =>
            user.socket.emit(
                "room:topic_update",
                group!.settings.selectedTopics
            )
        );
    });

    socket.on("room:changeRoundCount", (count: number) => {
        if (!(count % 2 == 0) || count > 12) {
            emitRoomErrorToUser(
                socket,
                "Can't change round count to provided value.",
                "WARNING"
            );
            return;
        }

        let room = getRoom(socket.data.roomID);

        if (!room) {
            emitRoomErrorToUser(
                socket,
                "Can't change round count, room doesn't exist.",
                "ERROR"
            );
            return;
        }

        room.settings.roundCount = count;

        room.users.forEach((groupUser) => {
            groupUser.socket.emit("room_state_update", {
                roomState: {
                    availableTopics: room!.availableTopics,
                    creator: room!.creator,
                    settings: room!.settings,
                },
            });
        });
    });

    socket.on("room:remove_topic", (topic: string) => {
        let group = getRoom(socket.data.roomID);

        if (!group) {
            emitRoomErrorToUser(
                socket,
                "Can't remove a topic, room doesn't exist.",
                "ERROR"
            );
            return;
        }

        group.settings.selectedTopics = group.settings.selectedTopics.filter(
            (item) => item != topic
        );
        group.users.forEach((user) =>
            user.socket.emit(
                "room:topic_update",
                group!.settings.selectedTopics
            )
        );
    });

    socket.on("disconnect", () => {
        logger.info(`Socket : ${socket.id} has disconnected.`);
        let group = getRoom(socket.data.roomID);

        if (group == undefined) {
            logger.error(
                "The group the disconnected socket was in no longer exists."
            );
            return;
        }

        // TODO : not sure if to close the room immediately, or let it sit for a bit
        // last user in group, remove entire group
        // else just remove user, then can notify the rest that a person left
        // if (group.users.length == 1) {
        //     active_rooms = active_rooms.filter(
        //         (item) => item.groupID != group?.groupID
        //     );
        // } else {
        //     group.users = group.users.filter(
        //         (item) => item.userID != socket.data.userID
        //     );
        // }

        group.users = group.users.filter(
            (item) => item.userID != socket.data.userID
        );

        // If users are in lobby then update them about player leaving
        // However if a player leaves during the game stage, Prompting and Guessing then need to abort the game.
        // Update users about a new game state, a error state.
        // TODO : before user is removed from group we could use the data to show a early finish from what is remaining
        // or we could pause the game, wait till another player joins and assign them that data
        // might need to make sure its the same user that was playing before
        // this all happening only in the game stage
        if (group.gameState.round == Rounds.Lobby) {
            updateActiveGroupUsersChanged(socket);
        } else if (
            group.gameState.round == Rounds.Guessing ||
            group.gameState.round == Rounds.Prompting
        ) {
            group.gameState.round = Rounds.ErrorAPlayerLeft;
            group.users.forEach((groupUser) => {
                groupUser.socket.emit("game_state_update", {
                    gameState: group!.gameState,
                    ourState: groupUser.gameState, // player doesn't really need this since game ended
                });
            });
        }
    });
});

httpsServer.listen(PORT, () => {
    logger.info(`Server running on port: ${PORT}`);
});
