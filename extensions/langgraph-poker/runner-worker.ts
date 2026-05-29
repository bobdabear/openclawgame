#!/usr/bin/env node
/**
 * runner-worker.ts — Railway worker mode for the LangGraph Poker AI runner.
 *
 * When RUNNER_MODE=worker, this process runs as a persistent Railway service
 * and polls the platform backend for queued AI runs to execute. This is the
 * alternative to launching per-run Kubernetes Jobs (RUNNER_MODE=job).
 *
 * Required env vars (set in the Railway service):
 *   LANGGRAPH_POKER_URL   — Platform backend URL (e.g. https://api.example.railway.app)
 *   AI_RUNNER_SERVICE_KEY — Shared secret for authenticating with /internal/runner/*
 *
 * Optional env vars:
 *   RUNNER_POLL_INTERVAL_MS — Milliseconds between claim polls (default: 5000)
 */

import { main } from "./runner-entrypoint.js";

const PLATFORM_URL = (process.env["LANGGRAPH_POKER_URL"] ?? "").replace(/\/+$/, "");
const SERVICE_KEY = process.env["AI_RUNNER_SERVICE_KEY"] ?? "";
const POLL_INTERVAL_MS = Math.max(
  1000,
  parseInt(process.env["RUNNER_POLL_INTERVAL_MS"] ?? "5000", 10),
);

if (!PLATFORM_URL) {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: "runner_worker_fatal",
      error: "LANGGRAPH_POKER_URL is required",
    }),
  );
  process.exit(1);
}
if (!SERVICE_KEY) {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: "runner_worker_fatal",
      error: "AI_RUNNER_SERVICE_KEY is required",
    }),
  );
  process.exit(1);
}

function workerLog(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
}

interface ClaimResponseData {
  run_id: string;
  env: Record<string, string>;
}

async function claimNextRun(): Promise<ClaimResponseData | null> {
  const resp = await fetch(`${PLATFORM_URL}/api/v1/internal/runner/claim`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!resp.ok) {
    throw new Error(`claim request failed: HTTP ${resp.status}`);
  }
  const data = (await resp.json()) as { run_id?: string | null; env?: Record<string, string> };
  if (!data.run_id) {
    return null;
  }
  return { run_id: data.run_id, env: data.env ?? {} };
}

async function completeRun(runId: string, success: boolean, reason: string): Promise<void> {
  try {
    const resp = await fetch(`${PLATFORM_URL}/api/v1/internal/runner/complete/${runId}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ success, reason }),
    });
    if (!resp.ok) {
      workerLog("runner_complete_failed", { run_id: runId, status: resp.status });
    }
  } catch (err) {
    workerLog("runner_complete_error", { run_id: runId, error: String(err) });
  }
}

async function executeRun(claimed: ClaimResponseData): Promise<void> {
  const { run_id, env: runEnv } = claimed;
  workerLog("runner_run_starting", { run_id });

  // Merge run-specific env vars into process.env so that main() and its child
  // process both receive them. We process one run at a time so mutation is safe.
  Object.assign(process.env, runEnv);

  let exitCode = 1;
  let reason = "runner_completed";
  try {
    exitCode = await main(process.env);
    reason = exitCode === 0 ? "runner_completed" : "runner_exited_nonzero";
    workerLog("runner_run_finished", { run_id, exit_code: exitCode, success: exitCode === 0 });
  } catch (err) {
    reason = "runner_exception";
    workerLog("runner_run_error", { run_id, error: String(err) });
  }

  await completeRun(run_id, exitCode === 0, reason);
}

async function pollLoop(): Promise<never> {
  workerLog("runner_worker_started", {
    platform_url: PLATFORM_URL,
    poll_interval_ms: POLL_INTERVAL_MS,
  });

  for (;;) {
    try {
      const claimed = await claimNextRun();
      if (claimed === null) {
        // Queue empty — wait and retry.
        await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        continue;
      }
      // Execute synchronously (one run at a time) so env vars don't collide.
      await executeRun(claimed);
    } catch (err) {
      workerLog("runner_poll_error", { error: String(err) });
      await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
}

// Only run when this file is the entry point (not when imported by tests).
const isEntryPoint =
  process.argv[1] != null &&
  (process.argv[1].endsWith("runner-worker.js") || process.argv[1].endsWith("runner-worker.ts"));

if (isEntryPoint) {
  pollLoop().catch((err: unknown) => {
    console.error("Fatal runner-worker error:", err);
    process.exit(1);
  });
}
