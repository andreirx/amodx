import type { OpenNextConfig } from "@opennextjs/aws/types/open-next.js";

// Every override below is today's resolved default, written out because the serving contract
// depends on each one (buffered Lambda, Function-URL payload, S3 ISR, original-mode tag cache,
// SQS). An upstream default change must show up as a reviewed diff, not silently.
const config = {
    default: {
        override: {
            wrapper: "aws-lambda",
            converter: "aws-apigw-v2",
            incrementalCache: "s3",
            tagCache: "dynamodb",       // OPENNEXT1-TAGMODE
            queue: "sqs",
        },
    },
    imageOptimization: {
        install: {
            packages: ["sharp@0.35.5"], // 4.x default is 0.35.4 (< GHSA-wq5f-xc86-pv6w fix)
            os: "linux",
            libc: "glibc",
            additionalArgs: "--cpu=arm64", // npm honours --cpu; --arch is ignored by npm 10, rejected by npm 12 (#1307)
        },
    },
    buildCommand: "npm run build",
} satisfies OpenNextConfig;

export default config;
