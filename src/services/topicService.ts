import * as availableTopics from "../topics.json";
import { arrayShuffle } from "../util";

function getCombinedTopicList(topicGroups: string[]): string[] {
    let topicGroupData: string[][] = [];

    topicGroups.forEach((topic) => {
        switch (topic) {
            case "cartoons":
                topicGroupData.push(availableTopics.cartoons);
                break;
            case "shows":
                topicGroupData.push(availableTopics.shows);
                break;
            case "movies":
                topicGroupData.push(availableTopics.movies);
                break;
            case "super heroes":
                topicGroupData.push(availableTopics["super heroes"]);
                break;
            case "anime":
                topicGroupData.push(availableTopics.anime);
                break;
            case "pokemon":
                topicGroupData.push(availableTopics.pokemon);
        }
    });

    return arrayShuffle(topicGroupData.flat());
}

export { getCombinedTopicList };
