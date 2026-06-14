import { defineConfig } from "cypress";

export default defineConfig({
  e2e: {
    baseUrl: "http://127.0.0.1:3112",
    supportFile: false,
  },
  video: false,
  screenshotOnRunFailure: true,
});
