import { Router } from "express";
import { getCombinedTopicList } from "../services/topicService";
import { promptModeration } from "../services/imageGenerationService";

const testRouter = Router();

testRouter.get("/test", async (req, res) => {
    // res.send(
    //     await getImageFromPrompt(
    //         "Guy dressed as the american flag, with a shield",
    //         1,
    //         "256x256"
    //     )
    // );

    const result: any = await promptModeration("dog walking in a park");
    if (result == undefined) {
        // TODO : deal with this stuff
        // failed moderation, ask user to try again.
    }

    console.log(result.categories);
    res.send(result);
});

testRouter.get("/testTopics", async (req, res) => {
    console.log("why");
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
