import { Router } from "express";
import { getCombinedTopicList } from "../services/topicService";
import { promptModeration } from "../services/imageGenerationService";

const testRouter = Router();

testRouter.get("/test", async (req, res) => {
  res.send("Hello");
});

testRouter.get("/testTopics", async (req, res) => {
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

export { testRouter };
