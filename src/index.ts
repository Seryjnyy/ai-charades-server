import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { OpenAI } from "openai";
import SocketIo, { Server } from "socket.io";
import { userRouter } from "./routes/room";
var bodyParser = require("body-parser");
var cors = require("cors");
import { logger } from "./logger";
import {
    imageGenerationSimulated,
    promptModeration,
} from "./services/imageGenerationService";
import { getCombinedTopicList } from "./services/topicService";
import { addUserToRoom, getRoom } from "./services/activeRoomService";

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
    results: (results: { results: Result[] }) => void;
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
}

interface InterServerEvents {}

interface SocketData {
    userID: string;
    roomID: string;
    userAvatarSeed: string;
}

const server = createServer(app);
const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
>(server, { cors: { origin: "*" } });
// if problem with websocket cors : https://www.youtube.com/watch?v=1BfCnjr_Vjg&t=392s
const PORT = process.env.PORT || 3000;

app.use(cors());

// TODO : group should be named room, or something uniform
// TODO : use tokens auth to only allow 1 web socket connection per account
// TODO : need persistent storage for groups
// might get a away with in memory for active groups for now

app.use(userRouter);

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
    availableTopics: TopicGroup[];
}

export interface RoomSettings {
    maxPlayer: number;
    gameType?: string;
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

function addUserToGroup(
    socket: SocketIo.Socket<
        ClientToServerEvents,
        ServerToClientEvents,
        InterServerEvents,
        SocketData
    >
) {
    let addedUser = addUserToRoom(
        socket.data.roomID,
        socket.data.userID,
        socket,
        createInitialUserGameState(),
        socket.data.userAvatarSeed
    );

    if (!addedUser) {
        logger.error(
            "Can't add user to group, because group no longer exists."
        );
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
io.use((socket, next) => {
    // TODO : User can only have one room
    // returns used to satisfy TS

    if (socket.handshake.query.userID == undefined) {
        next(new Error("Can't join because there is no userID."));
    }

    if (socket.handshake.query.groupID == undefined) {
        next(new Error("Can't join because there is no groupID."));
    }

    if (socket.handshake.query.userAvatarSeed == undefined) {
        next(new Error("Can't join because user has no avatar."));
    }

    // TODO : these already check for undefined, shouldn't need the code above
    if (typeof socket.handshake.query.userID != "string") {
        next(new Error("Can't join, userID is in wrong format."));
        return; // needed because TS for the checking @ in userID
    }

    if (typeof socket.handshake.query.groupID != "string") {
        next(new Error("Can't join, groupID is in wrong format."));
        return; // needed because TS for the checking @ in userID
    }

    if (typeof socket.handshake.query.userAvatarSeed != "string") {
        next(new Error("Can't join, userAvatarSeed is in wrong format."));
        return; // needed because TS for the checking @ in userID
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

io.on("connect", (socket) => {
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

    addUserToGroup(socket);

    let group = getRoom(socket.data.roomID);
    if (group == undefined) {
        emitRoomErrorToUser(
            socket,
            "Can't connect, room doesn't exist.",
            "ERROR"
        );
        return;
    }

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
        if (group.users.length < 1) {
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

        // set initial topics for both users

        // TODO : this is round amount, that the user should set, and we should get it from group.settings
        const topic_amount = 2;
        let topicList = getCombinedTopicList(group.settings.selectedTopics);

        // If there is not enough topics, in the topic groups that were selected, for users in the game then don't start
        if (topic_amount * group.users.length > topicList.length) {
            emitRoomErrorToUser(
                socket,
                "Can't start game, pick more topics.",
                "WARNING"
            );

            return;
        }

        group.users.forEach((user, index) => {
            user.gameState.topics = topicList.slice(
                index * topic_amount,
                (index + 1) * topic_amount
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

            // combine everything
            group.users.forEach((groupUser) => {
                groupUser.socket.emit("results", {
                    results: getResultsOfGame(group!),
                });
            });
        } else {
            user.socket.emit("game_state_update", {
                gameState: group.gameState,
                ourState: user.gameState,
            });
        }
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
        imageGenerationSimulated(message.prompt, 1, "256x256").then((res) => {
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

server.listen(PORT, () => {
    logger.info(`Server running on port: ${PORT}`);
});
