import chromium, { setupLambdaEnvironment } from "@sparticuz/chromium";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

// Linux fallback: npm-bundled browser/libraries, no Chromium CDN download.
const entry = fileURLToPath(import.meta.resolve("@sparticuz/chromium"));
const root = dirname(dirname(entry));
const { inflate } = await import(
  pathToFileURL(join(root, "build/lambdafs.js")).href
);
await inflate(join(root, "bin/al2023.tar.br"));
setupLambdaEnvironment("/tmp/al2023/lib");
const child = spawn(
  process.execPath,
  ["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      PLAYWRIGHT_CHROMIUM_EXECUTABLE: await chromium.executablePath(),
      PLAYWRIGHT_CHROMIUM_ARGS: JSON.stringify(
        chromium.args.filter((arg) => arg !== "--single-process"),
      ),
    },
  },
);
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
