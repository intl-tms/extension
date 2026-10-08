import { defineConfig } from "@playwright/test";

// One suite, in a real browser, against the built Extension and a fixture
// website on the real Core server. The steps share one browser profile and run
// in order.
export default defineConfig({
  testDir: "e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  reporter: "list",
});
