import { test as base, expect } from "@playwright/test";

// A fresh browser per test also isolates workers, fonts and PDF resources.
// Lambda/headless-shell builds can hang when reusing the browser after several contexts.
export const test = base.extend({
  context: async ({ playwright }, provideContext, info) => {
    const options = info.project.use;
    const browser = await playwright.chromium.launch(options.launchOptions);
    try {
      const context = await browser.newContext({
        baseURL: options.baseURL,
        viewport: options.viewport,
        acceptDownloads: true,
      });
      await provideContext(context);
    } finally {
      await browser.close();
    }
  },
});
export { expect };
