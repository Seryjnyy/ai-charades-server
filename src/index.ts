import "dotenv/config";
import express from "express";
import SocketIo from "socket.io";
import { createServer } from "http";
import { Server } from "socket.io";
import { OpenAI } from "openai";
import * as availableTopics from "./topics.json";

// Array shuffle function from the npm package
// a quick hack because node js wasn't having it, strange error about not supporting require() of ES Module
function arrayShuffle(array: any) {
    if (!Array.isArray(array)) {
        throw new TypeError(`Expected an array, got ${typeof array}`);
    }

    array = [...array];

    for (let index = array.length - 1; index > 0; index--) {
        const newIndex = Math.floor(Math.random() * (index + 1));
        [array[index], array[newIndex]] = [array[newIndex], array[index]];
    }

    return array;
}

const openai = new OpenAI({
    apiKey: process.env.OPEN_API_KEY,
});

const app = express();

// for POST
var bodyParser = require("body-parser");
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const server = createServer(app);

// interface SocketData {
//     userID: string;
//     groupID: string;
//   }

const io = new Server(server, { cors: { origin: "*" } });
// https://www.youtube.com/watch?v=1BfCnjr_Vjg&t=392s
// if problem with websocket cors
const PORT = process.env.PORT || 3000;
var cors = require("cors");

// cors enabler
app.use(cors());

// TODO : group should be named room, or something uniform

// TODO : use tokens auth to only allow 1 web socket connection per account

// TODO : need persistent storage for groups
// might get a away with in memory for active groups for now

// Settings used for server stuff (determine things like if to allow player cause maxPlayers)
// But Metadata for clients

interface GameState {
    currentTurnID: string;
    topics: string[];
    imageURIs: string[];
}

interface GameStateUser {
    topics: string[];
    prompts: string[];
    imageURIsFromPrompts: string[];
    topicPlace: number;
    promptPlace: number;
}

interface ActiveRoomUser {
    userID: string;
    socket: any;
    gameState: GameStateUser;
}

interface ActiveRoom {
    groupID: string;
    users: ActiveRoomUser[];
    settings: RoomSettings;
    creator: string;
    gameState: GameState;
    availableTopics: string[];
}

interface RoomSettings {
    maxPlayer?: number;
    gameType?: string;
    selectedTopics: string[];
}

interface Room {
    roomID: string;
    creator: string;
    settings: RoomSettings;
}

var temp_rooms: Room[] = [];

app.post("/api/rooms/create", (req, res) => {
    console.log("API USE");
    console.log(req.body.userID);

    // check for empty: userID, roomSettings

    var id = "id" + Math.random().toString(16).slice(2);
    temp_rooms.push({
        roomID: id,
        creator: req.body.userID,
        settings: {
            maxPlayer: req.body.roomSettings.maxPlayer,
            selectedTopics: req.body.roomSettings.selectedTopics,
        },
    });

    res.send(req.body);
});

app.get("/api/rooms/:userID", (req, res) => {
    let userRoomsIDs: string[] = [];

    temp_rooms.forEach((room) => {
        let found = room.creator == req.params.userID;
        if (found) userRoomsIDs.push(room.roomID);
    });

    res.send(JSON.stringify(userRoomsIDs));
});

app.get("/api/topics", (req, res) => {
    res.send(JSON.stringify(availableTopics.topicNames));
});

console.log("SERVER -- SERVER");

io.use((socket, next) => {
    // use middleware to check if user can open ws
    // check token and if belongs to this room
    // maybe check if they can on client instead
    console.log("middleware before connection");
    console.log(socket.handshake.query.userID);

    // check if group exists
    // check if user belongs to group they trying to join
    // socket.request._query.groupID;

    next();
});

function informUserAboutRoomMetadata(socket: SocketIo.Socket) {
    let group = active_rooms.find(
        (element) => element.groupID == socket.handshake.query.groupID
    );

    if (group == undefined) {
        console.log(
            "ERROR: Can't inform user about metadata because group doesn't exist."
        );
        return;
    }

    socket.emit("metadata", {
        gameType: "bowling",
        creator: group.creator,
        maxPlayer: group.settings.maxPlayer,
    });
}

// TODO : this should be part of game state or maybe a separate lobby room state im not sure
function updateActiveGroupUsersChanged(socket: SocketIo.Socket) {
    // on new socket connect, let everyone in group know about the change
    // send each socket in the group a updated list of users
    // send array of userIDs for now
    // need to find group again cause group from before can be null
    // TODO : could be better
    let group = active_rooms.find(
        (element) => element.groupID == socket.handshake.query.groupID
    );

    if (group == undefined) {
        console.log(
            "ERROR: Failed to update Active Group users that user list has changed because could not find Active Group."
        );
        return;
    }

    let userList = group.users.map((x) => x.userID);
    group.users.forEach((user) => {
        user.socket.emit("user_change", userList);
    });
}

function updateActiveGroupGameStateChanged(socket: SocketIo.Socket) {
    let group = active_rooms.find(
        (element) => element.groupID == socket.handshake.query.groupID
    );

    if (group == undefined) {
        console.log(
            "ERROR: Failed to update Active Group users that GameState has changed because could not find Active Group."
        );
        return;
    }

    let userList = group.users.map((x) => x.userID);
    group.users.forEach((user) => {
        console.log("updateing usrs");
        user.socket.emit("game_state_update", group!.gameState);
    });
}

function addUserToGroup(socket: SocketIo.Socket) {
    // Add the newly connected user to a active group
    // If the active group doesn't exist yet then create it first. (a active group doesn't exist when no one is connected yet)
    // TODO : when creating the active group, add metadata
    // TODO : ik updateActive... can be done after if, but want to keep the logic together, less messy

    let group = active_rooms.find(
        (element) => element.groupID == socket.handshake.query.groupID
    );
    if (group) {
        if (typeof socket.handshake.query.userID != "string") {
            return;
        }

        group.users.push({
            userID: socket.handshake.query.userID,
            socket: socket,
        });
        updateActiveGroupUsersChanged(socket);
    } else {
        // find the room data from when it was created
        let storedGroup = temp_rooms.find(
            (item) => item.roomID == socket.handshake.query.groupID
        );

        if (storedGroup == undefined) {
            console.log(
                "ERROR: Failed to create a Active Room because provided groupID is wrong. It does not match any of the existing rooms."
            );

            // TODO : can't continue here need to close
            socket.emit("errorEvent", "ERROR:Failed to create active group");
            return;
        }

        // check passed in data from client through query
        if (typeof socket.handshake.query.userID != "string") {
            return;
        }
        if (typeof socket.handshake.query.groupID != "string") {
            return;
        }

        // create active group
        active_rooms.push({
            groupID: socket.handshake.query.groupID,
            creator: storedGroup.creator,
            users: [{ userID: socket.handshake.query.userID, socket: socket }],
            settings: storedGroup.settings,
            gameState: {
                currentTurnID: storedGroup.creator,
                topics: [],
                imageURIs: [],
            },
            availableTopics: getCombinedTopicList(
                storedGroup.settings.selectedTopics
            ),
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

var active_rooms: ActiveRoom[] = [];
io.on("connect", (socket) => {
    console.log("SOCKET::CONNECTED");

    if (typeof socket.handshake.query.userID != "string") {
        return;
    }
    addUserToGroup(socket);

    // Once user is connected let them know about the room metadata (gametype, etc.)
    informUserAboutRoomMetadata(socket);

    // Game state
    // 2 out of 2 players etc.

    // group.console.log(temp_user_groups);

    // socket.on("message", (message) => {
    //     console.log(message);
    //     // io.emit("message", `${socket.id.substr(0, 2)} said ${message}`);
    // });

    socket.on("start_game", (message) => {
        let group = active_rooms.find(
            (element) => element.groupID == socket.handshake.query.groupID
        );

        if (group == undefined) {
            console.log(
                "ERROR: Cannot start game because the group does not exist."
            );
            return;
        }

        // initial topic
        if (group.availableTopics == undefined) {
            return;
        }

        // TODO : need this in all times the next topic is selected
        let nextTopic = group.availableTopics.shift();
        if (nextTopic == undefined) {
            console.log(
                "ERROR: Cant select the next topic because there are no topics left in the available topics array."
            );
            return;
        }

        group.gameState.topics.push(nextTopic);

        group.users.forEach((user) => {
            user.socket.emit("game_start", group!.gameState);
        });
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

        group?.gameState.imageURIs.push(
            "https://oaidalleapiprodscus.blob.core.windows.net/private/org-hztZ1B11qCqo2MUoKWShZ6U4/user-kICOmr4NZ4ku7BLM7W9xoS5W/img-XFUKqK6aoYq32XrjTwApyGTG.png?st=2023-10-23T21%3A58%3A04Z&se=2023-10-23T23%3A58%3A04Z&sp=r&sv=2021-08-06&sr=b&rscd=inline&rsct=image/png&skoid=6aaadede-4fb3-4698-a8f6-684d7786b067&sktid=a48cca56-e6da-484e-a814-9c849652bcb3&skt=2023-10-23T20%3A51%3A29Z&ske=2023-10-24T20%3A51%3A29Z&sks=b&skv=2021-08-06&sig=U3rtprSkuWVqmcl918sTqZNzDhXiKouqRegeashNp5o%3D"
        );

        updateActiveGroupGameStateChanged(socket);

        return;
        // temp for now to not waste api calls

        // do AI stuff etc.
        const response = openai.images
            .generate({
                prompt: "Green guy in loincloth standing in a swamp.",
                n: 1,
                size: "512x512",
            })
            .then((result) => {
                // TODO : I think it could do with checking if there is data first
                // TODO : Also considering a system with buffs like more pictures to chose from, this won't work for it
                group?.gameState.imageURIs.push(result.data[0].url!);

                updateActiveGroupGameStateChanged(socket);
            });

        return;

        // FIXME : this happens later on in the process not here!!!
        // Switch turns

        // TODO : implementation only works for 2 players, could think of something for more

        // let otherUser = group.users.find(
        //     (user) => user.userID != group?.gameState.currentTurnID
        // );

        // if (otherUser == undefined) {
        //     console.log(
        //         "ERROR: Can't switch turns cause other player is missing"
        //     );
        //     return;
        // }

        // group.gameState.currentTurnID = otherUser.userID;
        // console.log(
        //     "current turn : " +
        //         group.gameState.currentTurnID +
        //         " changing to : " +
        //         otherUser?.userID
        // );

        // // Add new topic for new current user

        // group.gameState.topics.push("helo" + Math.random());

        // updateActiveGroupGameStateChanged(socket);
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

        // last user in group, remove entire group
        // else just remove user, then can notify the rest that a person left
        if (group.users.length == 1) {
            active_rooms = active_rooms.filter(
                (item) => item.groupID != group?.groupID
            );
        } else {
            group.users = group.users.filter(
                (item) => item.userID != socket.handshake.query.userID
            );
        }
        // temp_users = temp_users.filter((x) => x.socket.id != socket.id);
        // console.log(temp_users.map((user) => user.id));
        console.log(active_rooms);
    });
});

server.listen(PORT, () => {
    console.log(`listening on ${PORT}`);
});
