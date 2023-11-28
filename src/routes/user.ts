import { Router } from "express";
import { isAccessKeyValid } from "../services/accessKeyService";

const userRouter = Router();

userRouter.post("/api/register", async (req, res) => {
    if (!req.body.accessKey) {
        res.status(400).send("No secret key provided.");
        return;
    }

    let isValid = await isAccessKeyValid(req.body.accessKey);
    if (!isValid) {
        res.status(401).send("Incorrect secret key provided");
        return;
    }

    // TODO : i could maybe generate a JWT for the access key, for short duration
    // then user uses that, but don't see the need rn
    res.status(200).send();
});

export { userRouter };
