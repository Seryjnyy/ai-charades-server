import { Router } from "express";
import { temp_rooms } from "..";

const userRouter = Router();

userRouter.post("/api/rooms/create", (req, res) => {
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

userRouter.get("/api/rooms/:userID", (req, res) => {
    let userRoomsIDs: string[] = [];

    temp_rooms.forEach((room) => {
        let found = room.creator == req.params.userID;
        if (found) userRoomsIDs.push(room.roomID);
    });

    res.send(JSON.stringify(userRoomsIDs));
});

export { userRouter };
