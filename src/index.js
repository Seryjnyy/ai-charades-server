const express = require("express");
var bodyParser = require("body-parser");
const app = express();

// for POST
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const http = require("http");
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, { cors: { origin: "*" } });
// https://www.youtube.com/watch?v=1BfCnjr_Vjg&t=392s
// if problem with websocket cors
const PORT = process.env.PORT || 3000;
var cors = require("cors");
const { log } = require("console");

// cors enabler
app.use(cors());

// TODO : group should be named room, or something uniform

// TODO : use tokens auth to only allow 1 web socket connection per account

// TODO : need persistent storage for groups
// might get a away with in memory for active groups for now

// Settings used for server stuff (determine things like if to allow player cause maxPlayers)
// But Metadata for clients

temp_rooms = [];

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
    let userRoomsIDs = [];

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
    console.log(socket.request._query.userID);

    // check if group exists
    // check if user belongs to group they trying to join
    // socket.request._query.groupID;

    next();
});

function updateActiveGroupUsersChanged(socket) {
    // on new socket connect, let everyone in group know about the change
    // send each socket in the group a updated list of users
    // send array of userIDs for now
    // need to find group again cause group from before can be null
    // TODO : could be better
    let group = temp_user_groups.find(
        (element) => element.groupID == socket.request._query.groupID
    );

    group.users.forEach((user) => {
        let userList = group.users.map((x) => x.userID);
        console.log("not happening");
        user.socket.emit("user_change", userList);
    });
}

temp_user_groups = [];
io.on("connect", (socket) => {
    console.log("SOCKET::CONNECTED");

    // Add the newly connected user to a active group
    // If the active group doesn't exist yet then create it first. (a active group doesn't exist when no one is connected yet)
    // TODO : when creating the active group, add metadata
    // TODO : ik updateActive... can be done after if, but want to keep the logic together, less messy

    let group = temp_user_groups.find(
        (element) => element.groupID == socket.request._query.groupID
    );
    if (group) {
        group.users.push({
            userID: socket.request._query.userID,
            socket: socket,
        });
        updateActiveGroupUsersChanged(socket);
    } else {
        console.log(temp_rooms);
        temp_user_groups.push({
            groupID: socket.request._query.groupID,
            users: [{ userID: socket.request._query.userID, socket: socket }],
            settings: temp_rooms.find(
                (item) => item.roomID == socket.request._query.groupID
            ).settings,
        });
        updateActiveGroupUsersChanged(socket);
    }

    // Once user is connected let them know about the room metadata (gametype, etc.)
    group = temp_user_groups.find(
        (element) => element.groupID == socket.request._query.groupID
    );
    socket.emit("metadata", {
        gametype: "bowling",
        maxPlayer: group.settings.maxPlayer,
    });

    // Game state
    // 2 out of 2 players etc.

    // group.console.log(temp_user_groups);

    // socket.on("message", (message) => {
    //     console.log(message);
    //     // io.emit("message", `${socket.id.substr(0, 2)} said ${message}`);
    // });

    socket.on("disconnect", () => {
        console.log("SOCKET::DISCONNECTED");
        let group = temp_user_groups.find(
            (element) => element.groupID == socket.request._query.groupID
        );

        // last user in group, remove entire group
        // else just remove user, then can notify the rest that a person left
        if (group.users.length == 1) {
            temp_user_groups = temp_user_groups.filter(
                (item) => item.groupID != group.groupID
            );
        } else {
            group.users = group.users.filter(
                (item) => item.userID != socket.request._query.userID
            );
        }
        // temp_users = temp_users.filter((x) => x.socket.id != socket.id);
        // console.log(temp_users.map((user) => user.id));
        console.log(temp_user_groups);
    });
});

server.listen(PORT, () => {
    console.log(`listening on ${PORT}`);
});
