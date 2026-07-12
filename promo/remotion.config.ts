import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
// The container ships a modern Playwright Chromium — run it in the new
// headless mode ("chrome-for-testing") instead of downloading Remotion's
// headless shell.
Config.setChromeMode('chrome-for-testing');
Config.setBrowserExecutable('/opt/pw-browsers/chromium');
// Font loading can exceed the default 28s delayRender budget when several
// render tabs compete for CPU in this container.
Config.setDelayRenderTimeoutInMilliseconds(120000);
Config.setConcurrency(2);
