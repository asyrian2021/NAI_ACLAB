import { defineConfig } from "@playwright/test";
import path from "node:path";
const port = Number(process.env.NAI_TEST_PORT || 18777);
export default defineConfig({
  testDir: "./tests/ui",
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: "msedge",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `python web_app.py ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    env: {
      NAI_ARTIST_LAB_USER_DIR: path.resolve(".test-data", "e2e-" + Date.now()),
    },
  },
});
