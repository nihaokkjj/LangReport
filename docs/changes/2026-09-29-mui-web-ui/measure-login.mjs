import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(resolve("apps/web/package.json"));
const { chromium } = require("@playwright/test");
const browser = await chromium.launch({ headless: true });
const variants = [
  { name: "baseline", port: 3100 },
  { name: "mui", port: 3101 },
];
const runs = [];

try {
  for (let index = 0; index < 7; index += 1) {
    for (const variant of index % 2 === 0 ? variants : [...variants].reverse()) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${variant.port}/login`, { waitUntil: "load" });
      const timing = await page.evaluate(() => {
        const navigation = performance.getEntriesByType("navigation")[0];
        const paint = performance.getEntriesByType("paint");
        return {
          domContentLoadedMs: navigation.domContentLoadedEventEnd,
          loadMs: navigation.loadEventEnd,
          firstContentfulPaintMs: paint.find((entry) => entry.name === "first-contentful-paint")?.startTime,
        };
      });
      const fields = page.locator("input");
      await fields.nth(0).fill("measure@example.com");
      await fields.nth(1).fill("measure-password");
      await page
        .getByRole("button")
        .filter({ hasText: /登录|sign in/i })
        .first()
        .waitFor({ state: "visible" });
      const editable = await Promise.all([fields.nth(0).inputValue(), fields.nth(1).inputValue()]);
      runs.push({
        variant: variant.name,
        warmup: index < 2,
        ...timing,
        editable: editable[0] === "measure@example.com" && editable[1] === "measure-password",
        errors,
      });
      await context.close();
    }
  }
} finally {
  await browser.close();
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const summary = Object.fromEntries(
  variants.map(({ name }) => {
    const sample = runs.filter((run) => run.variant === name && !run.warmup);
    return [
      name,
      {
        samples: sample.length,
        domContentLoadedMs: median(sample.map((run) => run.domContentLoadedMs)),
        loadMs: median(sample.map((run) => run.loadMs)),
        firstContentfulPaintMs: median(sample.map((run) => run.firstContentfulPaintMs)),
        editable: sample.every((run) => run.editable),
        pageErrors: sample.flatMap((run) => run.errors),
      },
    ];
  }),
);

process.stdout.write(`${JSON.stringify({ summary, runs }, null, 2)}\n`);
