import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npm start",
    url: "http://localhost:3000/dashboard",
    reuseExistingServer: false,
    timeout: 60000,
    env: { DEMO_MODE: "true", APP_URL: "http://localhost:3000" },
  },
});
