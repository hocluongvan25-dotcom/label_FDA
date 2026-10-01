import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { serviceClient, rpc } from "../src/server/context";
import {
  RegulatoryHttpClient,
  EcfrClient,
  FederalRegisterClient,
  RegulatoryApiError,
} from "../src/server/regulatory/clients";
import { SupabaseRegulatoryRepository } from "../src/server/regulatory/repository";
import { processRegulatoryIngestion } from "../src/server/regulatory/ingestion";
import type { RegulatoryIngestionJob } from "../src/lib/knowledge-types";
async function main() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(
      'npm run regulatory:worker [-- --once] or --enqueue ecfr_part101|ecfr_section|ecfr_discovery|fr_monitor. Set REGULATORY_CONTACT_EMAIL. Enqueue options: --section 101.9 --term "food labeling" --start YYYY-MM-DD --end YYYY-MM-DD --force --part101-only. --schedule enqueues the daily eCFR+FDA monitors automatically; --schedule-once only queues today’s schedule.',
    );
    return;
  }
  const contact = process.env.REGULATORY_CONTACT_EMAIL ?? "";
  const db = serviceClient();
  const repo = new SupabaseRegulatoryRepository(db);
  const http = new RegulatoryHttpClient({ contact, store: repo, attempts: 1 });
  const ecfr = new EcfrClient(http);
  const fr = new FederalRegisterClient(http);
  const worker = `regulatory:${hostname()}:${randomUUID()}`;
  const value = (flag: string) => args[args.indexOf(flag) + 1];
  if (args.includes("--schedule-once")) {
    const jobs = await rpc<string[]>(db, "vexim_schedule_regulatory_sync", {});
    console.log("Daily regulatory jobs queued:", jobs.length);
    return;
  }
  const pollMs = Number(process.env.REGULATORY_POLL_MS ?? 5000);
  if (!Number.isInteger(pollMs) || pollMs < 1000 || pollMs > 60000)
    throw new Error(
      "REGULATORY_POLL_MS must be an integer from 1000 to 60000.",
    );
  if (args.includes("--enqueue")) {
    const kind = value("--enqueue");
    const params: Record<string, unknown> = {};
    for (const [flag, key] of [
      ["--section", "section"],
      ["--term", "term"],
      ["--start", "start_date"],
      ["--end", "end_date"],
    ])
      if (args.includes(flag)) params[key] = value(flag);
    if (args.includes("--force")) params.force_refresh = true;
    if (args.includes("--part101-only")) params.cfr_part101_only = true;
    if (kind === "fr_monitor") {
      const today = new Date().toISOString().slice(0, 10);
      params.start_date ??= today;
      params.end_date ??= today;
      params.term ??= "food labeling";
    }
    const j = await rpc<RegulatoryIngestionJob>(
      db,
      "vexim_request_regulatory_ingestion",
      { job_kind: kind, job_params: params },
    );
    console.log("Queued regulatory job", j.id);
    return;
  }
  let stopping = false;
  process.on("SIGTERM", () => {
    stopping = true;
  });
  process.on("SIGINT", () => {
    stopping = true;
  });
  console.log(
    "Regulatory worker ready: official legal queries only; no labels/customer data, no automatic activation.",
  );
  let scheduledAt = 0;
  while (!stopping) {
    try {
      if (args.includes("--schedule") && Date.now() - scheduledAt > 60000) {
        await rpc(db, "vexim_schedule_regulatory_sync", {});
        scheduledAt = Date.now();
      }
      const job = await rpc<RegulatoryIngestionJob | null>(
        db,
        "vexim_claim_regulatory_ingestion",
        { worker_id: worker },
      );
      if (!job) {
        if (args.includes("--once")) break;
        await new Promise((r) => setTimeout(r, pollMs));
        continue;
      }
      let lost = false;
      const timer = setInterval(() => {
        void rpc<boolean>(db, "vexim_heartbeat_regulatory_ingestion", {
          jid: job.id,
          worker_id: worker,
        })
          .then((ok) => {
            if (!ok) lost = true;
          })
          .catch(() => {
            lost = true;
          });
      }, 30000);
      try {
        const result = await processRegulatoryIngestion(
          job,
          worker,
          repo,
          ecfr,
          fr,
        );
        if (lost) throw new Error("Regulatory job lease lost");
        await rpc(db, "vexim_finish_regulatory_ingestion", {
          jid: job.id,
          worker_id: worker,
          outcome: result,
        });
        console.log("Regulatory job completed", job.id, result.status);
      } catch (error) {
        const e =
          error instanceof RegulatoryApiError
            ? error
            : new RegulatoryApiError(
                "INGESTION_FAILED",
                "Regulatory ingestion failed; inspect validation/connection status.",
                false,
              );
        if (!lost)
          await rpc(db, "vexim_fail_regulatory_ingestion", {
            jid: job.id,
            worker_id: worker,
            code: e.code,
            message: e.message,
            temporary: e.retryable,
            retry_after: Math.ceil(e.retryAfter),
          }).catch(() => {
            lost = true;
          });
        console.error(
          "Regulatory job failed",
          job.id,
          e.code,
          "lease_lost",
          lost,
        );
      } finally {
        clearInterval(timer);
      }
      if (args.includes("--once")) break;
    } catch (error) {
      console.error(
        "Regulatory worker connection/lease error",
        error instanceof Error ? error.name : "UnknownError",
      );
      if (args.includes("--once")) throw error;
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}
main().catch((e) => {
  console.error(
    e instanceof Error ? e.message : "Regulatory worker startup failed",
  );
  process.exitCode = 1;
});
