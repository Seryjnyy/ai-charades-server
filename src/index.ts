import express from "express";
import SocketIo from "socket.io";
import { createServer } from "http";
import { Server } from "socket.io";

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
}

interface ActiveRoomUser {
    userID: string;
    socket: any;
}

interface ActiveRoom {
    groupID: string;
    users: ActiveRoomUser[];
    settings: RoomSettings;
    creator: string;
    gameState: GameState;
}

interface RoomSettings {
    maxPlayer?: number;
    gameType?: string;
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
        settings: { maxPlayer: req.body.roomSettings.maxPlayer },
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
            gameState: { currentTurnID: storedGroup.creator, topics: [] },
        });
        updateActiveGroupUsersChanged(socket);
    }
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
        group.gameState.topics.push("Shrek");

        group.users.forEach((user) => {
            user.socket.emit("game_start", group!.gameState);
        });
    });

    socket.on("submit_prompt", (message) => {
        // TODO : should probably check if the person can submit just in case i.e if their turn

        // do AI stuff etc.

        let group = active_rooms.find(
            (element) => element.groupID == socket.handshake.query.groupID
        );

        if (group == undefined) {
            console.log(
                "ERROR: Cannot accept submitted prompt because the group does not exist."
            );
            return;
        }

        // Switch turns

        // TODO : implementation only works for 2 players, could think of something for more
        let otherUser = group.users.find(
            (user) => user.userID != group?.gameState.currentTurnID
        );

        if (otherUser == undefined) {
            console.log(
                "ERROR: Can't switch turns cause other player is missing"
            );
            return;
        }

        group.gameState.currentTurnID = otherUser.userID;
        console.log(
            "current turn : " +
                group.gameState.currentTurnID +
                " changing to : " +
                otherUser?.userID
        );

        // Add new topic for new current user

        group.gameState.topics.push("helo" + Math.random());

        updateActiveGroupGameStateChanged(socket);
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
