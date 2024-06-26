import OpenAI from "openai";
import { logger } from "../logger";

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

async function promptModeration(prompt: string) {
    const result = await fetch(" https://api.openai.com/v1/moderations", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({ input: prompt }),
    });

    if (!result.ok) {
        return undefined;
    }

    return result.json();
}

async function imageGeneration(
    model:"dall-e-3" | "dall-e-2",
    prompt: string,
) {
    let size : "256x256" | "1024x1024" = "1024x1024"

    // For Dall-e 3 size needs to be min 1024, dall-e 2 is fine with 256x256
    switch(model){
        case "dall-e-3":
            size = "1024x1024"
            break;
        case "dall-e-2":
            size = "256x256"
            break;
    }

    
    // return imageGenerationSimulated()
    console.log("Calling AI for: ", prompt)
    const response = await openai.images
        .generate({
            model:model,
            prompt: prompt,
            n: 1,
            size: size,
            response_format:"url"
        })
        .catch((err) => {
            // TODO : idk what to do with the error
            console.log(err)
        });

    console.log("Response for: ", prompt)
    console.log(response)
    console.log("End of response")
    return response;
}

async function imageGenerationSimulated(

) {
    // await new Promise((resolve) => setTimeout(resolve, 3000));

    return {created:-1, data:[{url:"data:image/jpeg;base64,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"}]}
}

export { imageGeneration, promptModeration, imageGenerationSimulated };
