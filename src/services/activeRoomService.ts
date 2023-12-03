import SocketIo from "socket.io";
import { ActiveRoom, active_rooms, GameStateUser } from "../temp";

async function createRoom({
    groupID,
    creator,
    users,
    settings,
    gameState,
    availableTopics,
    resultState,
}: ActiveRoom) {
    await new Promise((resolve) => setTimeout(resolve, 1000));

    active_rooms.push({
        groupID: groupID,
        creator: creator,
        users: users,
        settings: settings,
        gameState: gameState,
        availableTopics: availableTopics,
        resultState: resultState,
    });

    return true;
}

// TODO : if rooms will be stored in persistant storage, then there is the issue of storing the socket
// rn it stores the socket object, would need to change to storing socket id, then storing the socket ref
// somewhere, or start using socket io rooms
async function addUserToRoom(
    roomID: string,
    userID: string,
    socket: SocketIo.Socket,
    gameState: GameStateUser,
    userAvatarSeed: string,
    initialCredits: number
) {
    let room = getRoom(roomID);

    if (room == undefined) {
        return false;
    }

    room.users.push({
        userID: userID,
        socket: socket,
        gameState: gameState,
        userAvatarSeed: userAvatarSeed,
        initialCredits: initialCredits,
    });

    return true;
}

function getRoom(roomID: string): ActiveRoom | undefined {
    let room = active_rooms.find((element) => element.groupID == roomID);

    return room;
}

export { createRoom, addUserToRoom, getRoom };
