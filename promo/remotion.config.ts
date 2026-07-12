import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
// The container ships a Playwright Chromium — use it instead of
// downloading Remotion's headless shell.
Config.setBrowserExecutable('/opt/pw-browsers/chromium');
