import { Router } from "express";
import { RoomSettings, Rounds, active_rooms, temp_rooms } from "..";
import { createRoom } from "../services/activeRoomService";
import * as availableTopics from "../topics.json";

const userRouter = Router();

function getRoomDefaultSettings(): RoomSettings {
    return { maxPlayer: 2, selectedTopics: [] };
}

// TODO : better random ID, or maybe db deals with this
function getRandomGroupID(): string {
    return "id" + Math.random().toString(16).slice(2);
}

function getAvailableTopics(): string[] {
    return availableTopics.topicNames;
}

userRouter.post("/api/rooms/create", async (req, res) => {
    // TODO : probably should be caught my middleware
    if (!req.body.userID) {
        res.status(400).send(
            "Couldn't create room because request is missing UserID."
        );
        return;
    }

    if (typeof req.body.userID != "string") {
        res.status(400).send(
            "Couldn't create room because because UserID is not string."
        );
        return;
    }

    let roomID = getRandomGroupID();

    let success = await createRoom({
        groupID: roomID,
        creator: req.body.userID,
        users: [],
        settings: getRoomDefaultSettings(),
        gameState: { round: Rounds.Lobby },
        availableTopics: getAvailableTopics(),
    });

    if (success) {
        console.log("sending this");
        res.send({ roomID: roomID });
    } else {
        res.status(500).send(
            "Couldn't create room because something went wrong. Try again in a bit."
        );
    }
});

userRouter.get("/api/rooms/:userID", (req, res) => {
    let userRoomsIDs: string[] = [];

    temp_rooms.forEach((room) => {
        let found = room.creator == req.params.userID;
        if (found) userRoomsIDs.push(room.roomID);
    });

    res.send(JSON.stringify(userRoomsIDs));
});

export { userRouter };
