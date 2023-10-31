import { ActiveRoom, GameState, RoomSettings, active_rooms } from "..";

export async function createRoom({
    groupID,
    creator,
    users,
    settings,
    gameState,
    availableTopics,
}: ActiveRoom) {
    await new Promise((resolve) => setTimeout(resolve, 1000));

    active_rooms.push({
        groupID: groupID,
        creator: creator,
        users: users,
        settings: settings,
        gameState: gameState,
        availableTopics: availableTopics,
    });

    return true;
}
