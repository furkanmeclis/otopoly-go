/**
 * Studio / CLI config. scripts/render-frames.mjs uses the Node APIs and passes
 * its options directly, so this file only affects `npm run studio` and `npx remotion still`.
 */
import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("png");
Config.setOverwriteOutput(true);
