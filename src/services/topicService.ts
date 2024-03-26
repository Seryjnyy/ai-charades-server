import * as availableTopics from "../topics.json";
import { arrayShuffle } from "../util";

function getCombinedTopicList(topicGroups: string[]): string[] {
    let topicGroupData: string[][] = [];

    topicGroups.forEach((topic) => {
        switch (topic) {
            case "cartoons":
                topicGroupData.push(availableTopics.cartoons);
                break;
            case "series":
                topicGroupData.push(availableTopics.series);
                break;
            case "films":
                topicGroupData.push(availableTopics.films);
                break;
            case "super heroes":
                topicGroupData.push(availableTopics["super heroes"]);
                break;
            case "anime":
                topicGroupData.push(availableTopics.anime);
                break;
            case "pokemon":
                topicGroupData.push(availableTopics.pokemon);
            case "games":
                topicGroupData.push(availableTopics.games);
        }
    });

    return arrayShuffle(topicGroupData.flat());
}

export { getCombinedTopicList };
