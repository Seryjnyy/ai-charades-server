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

const DELAY_BETWEEN_RETRIES = 3000

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

function isDateValid(dateString : string){
    const dateSplit : string[] = dateString.split("-")
    if(dateSplit.length < 3){
        return false
    }

    const todayDateSplit = new Date().toISOString().split("T")[0].split("-")

    // Check year
    if(parseInt(dateSplit[0]) < parseInt(todayDateSplit[0])){
        return false
    }

    // Check month
    // If the year is not larger than todays then check
    if( !(parseInt(dateSplit[0]) > parseInt(todayDateSplit[0])) && parseInt(dateSplit[1]) < parseInt(todayDateSplit[1])){
        return false
    }

    // Check day
    // If the month is not larger than todays then check
    if(!(parseInt(dateSplit[1])> parseInt(todayDateSplit[1])) && parseInt(dateSplit[2]) < parseInt(todayDateSplit[2])){
        return false
    }

    return true
}

async function isAccessKeyValid(accessKey: string) {
    let accessKeyData = await getAccessKeyData(accessKey);
    console.log(accessKeyData);
    if (accessKeyData == null) {
        return false;
    }

    if(accessKeyData.usesLeft <= 0){
        return false
    }

    if(typeof accessKeyData.expiryDate != "string"){
        return false
    }

    if(!isDateValid(accessKeyData.expiryDate)){
        return false
    }    

    console.log("ACCESS KEY IS VALID")
    return true;
}

function wait(delay:number){
    return new Promise((resolve) => setTimeout(resolve, delay));
}

async function attemptDecrementAccessKey(accessKey:string, amount:number, retries:number){
    for(let i = 0; i < retries; i++){
        if(await decrementAccessKey(accessKey, amount)){
            return true
        }
        await wait(DELAY_BETWEEN_RETRIES)
    }

    return false
}

async function decrementAccessKey(accessKey: string, amount:number) {
    console.log("DECREMENT KEY")
    const client = getDBClient();

    const accessKeyData = await getAccessKeyData(accessKey);
    
    if (accessKeyData == null) {
        console.log("Access key data does not exist");
        return false
    }

    const input: UpdateItemCommandInput = {
        TableName: "access-keys",
        Key: { accessKey: { S: accessKey } },
        ExpressionAttributeNames: {
            "#UT": "usesLeft",
        },
        ExpressionAttributeValues: {
            ":ut": {
                N: "" + (accessKeyData.usesLeft - amount),
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
            console.log("Failed to update access key")
            return false
        }

        console.log(results);
        return true
    } catch (err) {
        console.error(err);
        return false
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
    attemptDecrementAccessKey,
    isAccessKeyValid,
    getCreditAmountForAccessKey,
};
