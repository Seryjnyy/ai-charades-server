import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { OpenAI } from "openai";
import SocketIo, { Server } from "socket.io";
import { userRouter } from "./routes/room";
import * as availableTopics from "./topics.json";
import { arrayShuffle } from "./util";
var bodyParser = require("body-parser");
var cors = require("cors");

const openai = new OpenAI({
    apiKey: process.env.OPEN_API_KEY,
});

const app = express();

// for POST
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const server = createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
// if problem with websocket cors : https://www.youtube.com/watch?v=1BfCnjr_Vjg&t=392s
const PORT = process.env.PORT || 3000;

app.use(cors());

// TODO : group should be named room, or something uniform

// TODO : use tokens auth to only allow 1 web socket connection per account

// TODO : need persistent storage for groups
// might get a away with in memory for active groups for now

// Settings used for server stuff (determine things like if to allow player cause maxPlayers)
// But Metadata for clients

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
interface GameStateUser {
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
    socket: any;
    gameState: GameStateUser;
    userAvatarSeed: string;
}

export interface ActiveRoom {
    groupID: string;
    users: ActiveRoomUser[];
    settings: RoomSettings;
    creator: string;
    gameState: GameState;
    availableTopics: string[];
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
function updateActiveGroupUsersChanged(socket: SocketIo.Socket) {
    // on new socket connect, let everyone in group know about the change
    // send each socket in the group a updated list of users
    // send array of userIDs for now
    // need to find group again cause group from before can be null
    // TODO : could be better
    let group = getGroup(socket);

    if (group == undefined) {
        console.log(
            "ERROR: Failed to update Active Group users that user list has changed because could not find Active Group."
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

function addUserToGroup(socket: SocketIo.Socket) {
    // Add the newly connected user to a active group
    // If the active group doesn't exist yet then create it first. (a active group doesn't exist when no one is connected yet)
    // TODO : when creating the active group, add metadata
    // TODO : ik updateActive... can be done after if, but want to keep the logic together, less messy

    let group = getGroup(socket);

    if (group) {
        if (typeof socket.handshake.query.userID != "string") {
            return;
        }

        let userAvatarSeed = socket.handshake.query.userAvatarSeed;
        if (userAvatarSeed == undefined || typeof userAvatarSeed != "string") {
            userAvatarSeed = "" + Date();
        }

        group.users.push({
            userID: socket.handshake.query.userID,
            socket: socket,
            gameState: createInitialUserGameState(),
            userAvatarSeed: userAvatarSeed,
        });
        updateActiveGroupUsersChanged(socket);
    }
}

// TODO : better way would be to add a available topics array to the Active Group, in randomised order
// then just pick from the start of the array
// could trim the array to length of rounds, and or leave more for skipping
function getCombinedTopicList(topicGroups: string[]): string[] {
    let topicGroupData: string[][] = [];

    topicGroups.forEach((topic) => {
        switch (topic) {
            case "cartoons":
                topicGroupData.push(availableTopics.cartoons);
                break;
            case "shows":
                topicGroupData.push(availableTopics.shows);
                break;
        }
    });

    return arrayShuffle(topicGroupData.flat());
}

app.get("/test", async (req, res) => {
    res.send(
        await getImageFromPrompt(
            "Guy dressed as the american flag, with a shield",
            1,
            "256x256"
        )
    );
});

app.get("/testTopics", async (req, res) => {
    let topicList = getCombinedTopicList(["cartoons", "shows"]);

    let topic_amount = 3;
    let results = [];
    for (let i = 0; i < 2; i++) {
        results.push({
            id: i,
            topics: topicList.slice(i * topic_amount, (i + 1) * topic_amount),
        });
    }

    res.send({ original: topicList, results: results });
});

app.get("/rooms", (req, res) => {
    res.send(
        JSON.stringify(
            active_rooms.map((room) => ({
                roomID: room.groupID,
                creator: room.creator,
                users: room.users.map((user) => ({ userID: user.userID })),
            }))
        )
    );
});

// Simulate delays with gpt
export const getImageFromPrompt = async (
    prompt: string,
    amount: number,
    size: "256x256" | "512x512" | "1024x1024"
) => {
    // await new Promise((resolve) => setTimeout(resolve, 5000));

    // do AI stuff etc.
    // const response = await openai.images.generate({
    //     prompt: prompt,
    //     n: amount,
    //     size: size,
    // });

    // TODO : I think it could do with checking if there is data first
    // TODO : Also considering a system with buffs like more pictures to chose from, this won't work for it

    // console.log(response.data[0].url);

    return "data:image/jpeg;base64,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";
    // return response.data[0].url != undefined
    //     ? response.data[0].url
    //     : "data:image/jpeg;base64,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";
};

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

    // TODO : change back for it to work properly, only for testing rn
    // if (group.users.length < 2) {
    //     console.log(
    //         "ERROR : cant generate results because player data is missing."
    //     );
    // }

    // TODO : change back for it to work properly, only for testing rn
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

function getGroup(socket: SocketIo.Socket): ActiveRoom | undefined {
    let group = active_rooms.find(
        (element) => element.groupID == socket.handshake.query.groupID
    );

    if (group == undefined) {
        console.log("WARNING: Cannot find group");
    }

    return group;
}

// TODO : implement this
// probably using a token system
// check token and if belongs to this room

function isUserValid(): boolean {
    return true;
}

function canUserJoinGroup(socket: SocketIo.Socket): boolean {
    let group = getGroup(socket);

    // TODO : commented out for now because I don't know how to solve this issue.
    // client connects through socket in useEffect, but in dev useEffect renders twice
    // so 2 connection attempts are made for the same client.
    // Even providing a clean up function, socket.disconnect, it still happens because the 2nd connection is faster than the clean up
    // NVM, but if there is issue with this, this might be it
    if (group) {
        if (group.users.length > group.settings.maxPlayer) {
            console.log("ERROR : Can't join group because room is full.");
            return false;
        }
    }

    return true;
}

console.log("SERVER -- SERVER -- SERVER -- SERVER -- SERVER -- SERVER --");

// Middleware, for initial socket connection
io.use((socket, next) => {
    // TODO : User can only have one room
    if (!isUserValid()) {
        next(new Error("Authentication error"));
    }

    if (!canUserJoinGroup(socket)) {
        next(new Error("Can't join group"));
    }

    next();
});

export var active_rooms: ActiveRoom[] = [];

io.on("connect", (socket) => {
    console.log("SOCKET::CONNECTED");

    if (typeof socket.handshake.query.userID != "string") {
        return;
    }

    addUserToGroup(socket);
    let group = getGroup(socket);
    socket.emit("room_state_update", {
        roomState: {
            availableTopics: group?.availableTopics,
            creator: group?.creator,
            settings: group?.settings,
        },
    });

    // }})

    // Game state
    // 2 out of 2 players etc.

    // group.console.log(temp_user_groups);

    // socket.on("message", (message) => {
    //     console.log(message);
    //     // io.emit("message", `${socket.id.substr(0, 2)} said ${message}`);
    // });

    socket.on("start_game", (message) => {
        let group = getGroup(socket);

        if (group == undefined) {
            console.log(
                "ERROR: Cannot start game because the group does not exist."
            );
            return;
        }

        // TODO : Check if there are 2 players
        if (group.users.length < 1) {
            console.log(
                "ERROR: Can't start because there is not enough players."
            );
            return;
        }

        // START CREATING PROMPTS STAGE

        if (group.settings.selectedTopics.length == 0) {
            console.log("ERROR : No available topics, pick some topics");
            return;
        }

        // set initial topics for both users
        // TODO : this is not working correctly, only getting 2 topics instead of 3

        const topic_amount = 1;
        let topicList = getCombinedTopicList(group.settings.selectedTopics);

        console.log(topicList);
        group.users.forEach((user, index) => {
            // TODO : There will be issues if there is not enough topics
            user.gameState.topics = topicList.slice(
                index * topic_amount,
                (index + 1) * topic_amount
            );
        });

        // Update game state to the first round
        group.gameState.round = Rounds.Prompting;

        // TODO : this could be done my the function that updates users about game state
        group.users.forEach((user) => {
            user.socket.emit("game_start", {
                gameState: group?.gameState,
                ourState: user.gameState,
            });
        });

        // Then update each user about their own game state
    });

    socket.on("submit_guess", (message) => {
        let group = active_rooms.find(
            (element) => element.groupID == socket.handshake.query.groupID
        );

        if (group == undefined) {
            console.log(
                "ERROR: Cannot accept submitted guess because the group does not exist."
            );
            return;
        }

        // Get user
        let user = group.users.find(
            (item) => item.userID == socket.handshake.query.userID
        );

        if (user == undefined) {
            // shouldn't happen but just in case
            console.log("ERROR : user not found when submitting a guess");
            return;
        }

        // save guess
        console.log(message);
        user.gameState.guesses.push(message.guess);
        user.gameState.guessPlace += 1;

        // Check if all users are finished
        let everyoneFinished = true;

        // Check all users, if they have not went through their entire topics array then not everyone finished yet
        group.users.forEach((groupUser) => {
            if (
                groupUser.gameState.guessPlace <
                groupUser.gameState.imagesToGuess.length
            ) {
                everyoneFinished = false;
            }
        });

        // TODO : fix submit prompts first for all players then copy solution to this
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

    socket.on("submit_prompt", (message) => {
        // TODO : should probably check if the person can submit just in case i.e if their turn
        // TODO : check the user provided prompt just incase, for example length.

        let group = active_rooms.find(
            (element) => element.groupID == socket.handshake.query.groupID
        );

        if (group == undefined) {
            console.log(
                "ERROR: Cannot accept submitted prompt because the group does not exist."
            );
            return;
        }

        // Get user
        let user = group.users.find(
            (item) => item.userID == socket.handshake.query.userID
        );

        if (user == undefined) {
            // shouldn't happen but just in case
            console.log("ERROR : user not found when submitting a prompt");
            return;
        }

        // Save user prompt to user game state
        // TODO : pass in from user message
        // TODO : should do some checks before
        user.gameState.prompts.push(message.prompt);

        user.gameState.topicPlace += 1;

        // ask dalle for image
        // TODO : resolve prompt issues at the end, like if dalle refuses, when user is done then redo basically
        getImageFromPrompt(message.prompt, 1, "256x256").then((res) => {
            user!.gameState.imageURIsFromPrompts.push(res);

            // Check if all users are finished
            let everyoneFinished = true;

            // TODO : should throw errors to user
            if (group!.users.length < 2) {
                console.log(
                    "ERROR : Not enough players for the guessing stage"
                );
                return;
            }

            group!.users[0].gameState.imagesToGuess =
                group!.users[1].gameState.imageURIsFromPrompts;
            group!.users[1].gameState.imagesToGuess =
                group!.users[0].gameState.imageURIsFromPrompts;

            // Check all users, if they have not went through their entire topics array then not everyone finished yet
            // TODO : i think group won't be undefined here idk tho
            group!.users.forEach((groupUser) => {
                if (
                    groupUser.gameState.imageURIsFromPrompts.length !=
                    groupUser.gameState.topics.length
                ) {
                    everyoneFinished = false;
                    console.log(
                        "FAALSE NOT EVERYONE FISNISHEDJOJLFOIHASDOIFJHNIO HJNIL"
                    );
                }
            });

            // TODO : can't really start guessing round if all images have not yet been generated, this doesn't account for that
            if (everyoneFinished) {
                console.log("EVeryone did finishd");
                group!.gameState.round = Rounds.Guessing;

                // There is only 2 players so exchange their image links

                group!.users.forEach((user) => {
                    // TODO : basically code from below get the other players images and set it for this user
                    user.gameState.imagesToGuess =
                        user.gameState.imageURIsFromPrompts;

                    user.socket.emit("game_state_update", {
                        gameState: group!.gameState,
                        ourState: user.gameState,
                    });
                });
            } else {
                // Update the user who submitted the prompt
                // TODO : I don't think we need to update the user each time a picture generated successfully for now
                // user!.socket.emit("game_state_update", {
                //     gameState: group!.gameState,
                //     ourState: user!.gameState,
                // });
            }

            // need to give each user the images they will be answering
            // TODO : only works if there are 2 players, will not work when more

            // TODO : uncomment this!!!
            // let otherUser = group.users.find(
            //     (item) => item.userID != socket.handshake.query.userID
            // );
            // if (otherUser == undefined) {
            //     console.log(
            //         "ERROR: can't continue game to guessing round because other player is missing"
            //     );
            //     return;
            // }

            // TODO : this is only doing it for one player right now :/
            // TODO : and this
            // user.gameState.imagesToGuess =
            //     otherUser.gameState.imageURIsFromPrompts;
        });

        // TODO : not ideal cause have to update all game state each time, but probably not a big issue, probably ignore this
        user.socket.emit("game_state_update", {
            gameState: group.gameState,
            ourState: user.gameState,
        });

        return;
    });

    socket.on("room:select_topic", (topic: string) => {
        let group = getGroup(socket);

        group?.settings.selectedTopics.push(topic);

        group?.users.forEach((user) =>
            user.socket.emit(
                "room:topic_update",
                group?.settings.selectedTopics
            )
        );
    });

    socket.on("room:remove_topic", (topic: string) => {
        let group = getGroup(socket);

        if (!group) return;

        group.settings.selectedTopics = group?.settings.selectedTopics.filter(
            (item) => item != topic
        );
        group?.users.forEach((user) =>
            user.socket.emit(
                "room:topic_update",
                group?.settings.selectedTopics
            )
        );
    });

    socket.on("disconnect", () => {
        console.log("SOCKET::DISCONNECTED");
        let group = active_rooms.find(
            (element) => element.groupID == socket.handshake.query.groupID
        );

        if (group == undefined) {
            console.log(
                "ERROR:The group the socket was connected to no longer exists."
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
        //         (item) => item.userID != socket.handshake.query.userID
        //     );
        // }

        group.users = group.users.filter(
            (item) => item.userID != socket.handshake.query.userID
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

        console.log(active_rooms);
    });
});

server.listen(PORT, () => {
    console.log(`listening on ${PORT}`);
});
