import { Router } from "express";
import * as availableTopics from "../topics.json";

const topicRouter = Router();

topicRouter.get("/api/topics", (req, res) => {
    res.send(JSON.stringify(availableTopics.topicNames));
});
