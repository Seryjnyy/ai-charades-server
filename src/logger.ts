import winston, { config, createLogger, format, transports } from "winston";
import util from "util";

// const consoleTransport = new transports.Console(
//     {
//         level : "silly",
//         handleExceptions:true,
//         json: true,

//     }
// );
const combineMessageAndSplat = format((info, opts) => {
    //combine message and args if any
    info.message = util.format(
        info.message,
        ...(info[Symbol.for("splat")] || [])
    );
    return info;
});

const consoleTransport = new transports.Console({
    // log data if it's level is higher or equal to this level
    level: "silly",
    // handle exceptions thrown in the transports
    handleExceptions: true,
    // format the output
    format: format.combine(
        // include stack trace if available
        format.errors({ stack: true }),
        // format errors just like console.log
        combineMessageAndSplat(),
        // include timestamp in the output
        format.timestamp({ format: "HH:mm:ss.SSS" }),
        // colorize the output based on log level
        format.colorize(),
        // format the final output as a string with format: timestamp level: message stack-trace (if available)
        format.printf(
            ({ level, message, timestamp, stack }) =>
                `${timestamp} ${level}: ${message} ${stack || ""}`
        )
    ),
});

const logger = createLogger({
    levels: config.npm.levels,
    defaultMeta: {
        environment: process.env.NODE_ENV || "local",
    },
    transports: [consoleTransport],
    // format: format.combine(
    //     format.errors({ stack: "true" }),
    //     format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
    //     format.json({ space: 2, replacer: null }),
    //     format.prettyPrint()
    // ),
    format: winston.format.json(),
});

export { logger };
