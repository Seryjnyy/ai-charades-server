import {
    DynamoDBClient,
    GetItemCommand,
    GetItemCommandInput,
    UpdateItemCommand,
    UpdateItemCommandInput,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import "dotenv/config";

const AWS_ACCESS_KEY = process.env.AWS_ACCESS_KEY_ID
    ? process.env.AWS_ACCESS_KEY_ID
    : "";
const AWS_SECRET_KEY = process.env.AWS_SECRET_ACCESS_KEY
    ? process.env.AWS_SECRET_ACCESS_KEY
    : "";

function getDBClient() {
    return new DynamoDBClient({
        region: "eu-west-2",
        credentials: {
            accessKeyId: AWS_ACCESS_KEY,
            secretAccessKey: AWS_SECRET_KEY,
        },
    });
}

async function getCreditAmountForAccessKey(accessKey: string) {
    let accessKeyData = await getAccessKeyData(accessKey);

    if (accessKeyData == undefined) {
        return null;
    }

    return accessKeyData.usesLeft;
}

async function isAccessKeyValid(accessKey: string) {
    let accessKeyData = await getAccessKeyData(accessKey);
    console.log(accessKeyData);
    if (accessKeyData == null) {
        return false;
    }
    // wrong accessKey provided
    // TODO : expired access key, sorry access key is no longer valid
    // also no longer valid if has 0 uses left
    // console.log(new Date() < new Date("2023-11-04T17:58Z"));

    return true;
}

async function decrementAccessKey(accessKey: string) {
    const client = getDBClient();

    const accessKeyData = await getAccessKeyData(accessKey);

    if (accessKeyData == null) {
        console.log("Access key data does not exist");
        return;
    }

    const input: UpdateItemCommandInput = {
        TableName: "access-keys",
        Key: { accessKey: { S: accessKey } },
        ExpressionAttributeNames: {
            "#UT": "usesLeft",
        },
        ExpressionAttributeValues: {
            ":ut": {
                N: "" + (accessKeyData.usesLeft - 1),
            },
        },
        UpdateExpression: "SET #UT = :ut",
    };

    const command = new UpdateItemCommand(input);
    try {
        const results = await client.send(command);

        if (results.$metadata.httpStatusCode != 200) {
            // something went wrong
            // internal server error
        }

        console.log(results);
    } catch (err) {
        console.error(err);
    }
}

async function getAccessKeyData(accessKey: string) {
    const client = getDBClient();

    const input: GetItemCommandInput = {
        TableName: "access-keys",
        Key: { accessKey: { S: accessKey } },
    };
    const command = new GetItemCommand(input);

    try {
        const results = await client.send(command);

        if (results.$metadata.httpStatusCode != 200) {
            // something went wrong
            // internal server error
            return null;
        }

        if (results.Item == undefined) {
            return null;
        }

        let unmarshalled = unmarshall(results.Item);

        console.log(unmarshalled);
        return unmarshalled ? unmarshalled : null;
    } catch (err) {
        console.log("printing error");
        // console.error(err);
        return null;
    }

    console.log("flopped it");
}

export {
    getAccessKeyData,
    decrementAccessKey,
    isAccessKeyValid,
    getCreditAmountForAccessKey,
};
