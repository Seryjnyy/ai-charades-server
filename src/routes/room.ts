import { Router } from "express";
import {
    RoomSettings,
    Rounds,
    TopicGroup,
    active_rooms,
    temp_rooms,
} from "../temp";
import { createRoom } from "../services/activeRoomService";
import * as availableTopics from "../topics.json";

const roomRouter = Router();

function getRoomDefaultSettings(): RoomSettings {
    return {
        maxPlayer: 2,
        selectedTopics: [],
        nextResultPermission: "host",
        roundCount: 2,
    };
}

// TODO : better random ID, or maybe db deals with this
function getRandomGroupID(): string {
    return "id" + Math.random().toString(16).slice(2);
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
                itemsInTopic: availableTopics[topic].length,
            });
        }
    });

    return topics;
}

roomRouter.post("/api/rooms/create", async (req, res) => {
    console.log("sthi");
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

    // let success = await createRoom({
    //     roomID: roomID,
    //     creator: req.body.userID,
    //     users: [],
    //     settings: getRoomDefaultSettings(),
    //     state: "LOBBY"
    //     lobbyState:{availableTopics: getAvailableTopics()},
    //     resultState: { results : [], resultPlace: 0, currentRevealer:undefined},
    // });

    // if (success) {
    //     console.log("sending this");
    //     res.send({ roomID: roomID });
    // } else {
    //     res.status(500).send(
    //         "Couldn't create room because something went wrong. Try again in a bit."
    //     );
    // }
});

// roomRouter.get("/api/rooms/:userID", (req, res) => {
//     let userRoomsIDs: string[] = [];

//     temp_rooms.forEach((room) => {
//         let found = room.creator == req.params.userID;
//         if (found) userRoomsIDs.push(room.roomID);
//     });

//     res.send(JSON.stringify(userRoomsIDs));
// });

export { roomRouter };
