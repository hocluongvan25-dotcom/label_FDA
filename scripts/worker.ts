import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { serviceClient, rpc } from "../src/server/context";
import { processJob, type PipelineJob } from "../src/server/pipeline";
import { UnsafeFileError } from "../src/server/virus-scan";

async function main() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  await mkdir("/tmp/vexim-ocr-cache", { recursive: true });
  const db = serviceClient();
  const workerId = `${hostname()}:${randomUUID()}`;
  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
  });
  process.on("SIGTERM", () => {
    stopping = true;
  });
  console.log(
    "Vexim worker ready. Provider:",
    process.env.OCR_PROVIDER === "approved" ? "approved endpoint" : "local OCR",
  );
  console.log("Labels and provider keys are never written to stdout.");
  while (!stopping) {
    try {
      const job = await rpc<PipelineJob | null>(db, "vexim_claim_job", {
        worker_id: workerId,
      });
      if (!job) {
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            Math.max(1000, Number(process.env.WORKER_POLL_MS ?? 3000)),
          ),
        );
        continue;
      }
      console.log("Processing job", job.id, "attempt", job.attempts);
      try {
        await processJob(db, job, workerId);
        console.log("Completed job", job.id);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Pipeline failed";
        await rpc(db, "vexim_fail_job", {
          jid: job.id,
          worker_id: workerId,
          message,
          terminal: error instanceof UnsafeFileError,
        });
        console.error(
          "Job failed",
          job.id,
          error instanceof Error ? error.name : "UnknownError",
        );
      }
    } catch (error) {
      console.error(
        "Worker connection/lease error:",
        error instanceof Error ? error.name : "UnknownError",
      );
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  console.log("Worker stopped gracefully.");
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Worker startup failed",
  );
  process.exitCode = 1;
});
