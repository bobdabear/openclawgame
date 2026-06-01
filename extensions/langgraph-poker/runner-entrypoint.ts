#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_ENV = [
  "RUN_ID",
  "LANGGRAPH_POKER_URL",
  "PLATFORM_API_KEY",
  "LLM_PROVIDER",
  "LLM_MODEL",
  "LLM_API_KEY",
  "SYSTEM_PROMPT",
  "MAX_DURATION_SECONDS",
] as const;
const SECRET_VALUE_RE = /\b(?:sk|agk|pk|pat)_[A-Za-z0-9_-]{8,}\b/gi;
export const RUNNER_ALLOWED_TOOLS = [
  ...[
    "get_account_info",
    "list_tables",
    "create_table",
    "join_table",
    "get_game_state",
    "submit_action",
    "ready_next_hand",
    "leave_table",
  ],
  // Embedded runtime MCP tools are registered as <server>__<tool> names.
  // Include both canonical and normalized server prefixes so an internal
  // naming change does not strand queued paid runs in immediate failure.
  ...["langgraph-poker", "langgraph_poker", "mcp__langgraph-poker", "mcp__langgraph_poker"].flatMap(
    (prefix) =>
      [
        "get_account_info",
        "list_tables",
        "create_table",
        "join_table",
        "get_game_state",
        "submit_action",
        "ready_next_hand",
        "leave_table",
      ].map((tool) => `${prefix}__${tool}`),
  ),
] as const;

export type RunnerEnv = {
  runId: string;
  platformUrl: string;
  platformApiKey: string;
  llmProvider: string;
  llmModel: string;
  llmApiKey: string;
  systemPrompt: string;
  assetS3Url: string;
  runtimeMode: string;
  maxDurationSeconds: number;
  agentOnlyTable: boolean;
};

function required(name: (typeof REQUIRED_ENV)[number], env: NodeJS.ProcessEnv): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required AI runner env var: ${name}`);
  }
  return value;
}

export function readRunnerEnv(env: NodeJS.ProcessEnv = process.env): RunnerEnv {
  const maxDurationSeconds = Number(required("MAX_DURATION_SECONDS", env));
  if (!Number.isInteger(maxDurationSeconds) || maxDurationSeconds <= 0) {
    throw new Error("MAX_DURATION_SECONDS must be a positive integer");
  }

  return {
    runId: required("RUN_ID", env),
    platformUrl: required("LANGGRAPH_POKER_URL", env).replace(/\/+$/, ""),
    platformApiKey: required("PLATFORM_API_KEY", env),
    llmProvider: required("LLM_PROVIDER", env).toLowerCase(),
    llmModel: required("LLM_MODEL", env),
    llmApiKey: required("LLM_API_KEY", env),
    systemPrompt: required("SYSTEM_PROMPT", env),
    assetS3Url: env["ASSET_S3_URL"]?.trim() ?? "",
    runtimeMode: env["RUNTIME_MODE"]?.trim() || "job",
    maxDurationSeconds,
    agentOnlyTable: env["AGENT_ONLY_TABLE"]?.trim().toLowerCase() !== "false",
  };
}

export function applyProviderEnv(config: RunnerEnv, env: NodeJS.ProcessEnv = process.env): void {
  switch (config.llmProvider) {
    case "openai": {
      env.OPENAI_API_KEY = config.llmApiKey;
      break;
    }
    case "anthropic": {
      env.ANTHROPIC_API_KEY = config.llmApiKey;
      break;
    }
    default: {
      throw new Error(`Unsupported AI runner LLM_PROVIDER: ${config.llmProvider}`);
    }
  }
}

export function buildAutoTask(config: RunnerEnv, prompt: string): string {
  const tableScope = config.agentOnlyTable
    ? "Prefer agent-only Hold'em tables when available."
    : "Public Hold'em tables are allowed when legal and bankroll-safe.";
  return [
    "You are the managed LangGraph Poker runner for this paid AI run.",
    `Run id: ${config.runId}. Runtime mode: ${config.runtimeMode}.`,
    tableScope,
    "Use the langgraph-poker MCP tools to list tables, join an appropriate Hold'em table, inspect game state, and submit legal actions.",
    "Do not reveal private hole cards or API keys in logs. Stop when the run budget, duration, or platform rules require it.",
    "User strategy prompt:",
    prompt,
  ].join("\n");
}

export function redactRunnerLogValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(SECRET_VALUE_RE, "[REDACTED]");
  }
  return value;
}

export function formatRunnerLog(event: string, fields: Record<string, unknown> = {}): string {
  const safeFields = Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, redactRunnerLogValue(value)]),
  );
  return JSON.stringify({ ts: new Date().toISOString(), event, ...safeFields });
}

function logRunnerEvent(event: string, fields: Record<string, unknown> = {}): void {
  console.log(formatRunnerLog(event, fields));
}

async function appendAssetPrompt(config: RunnerEnv): Promise<string> {
  if (!config.assetS3Url) {
    return config.systemPrompt;
  }
  const response = await fetch(config.assetS3Url);
  if (!response.ok) {
    throw new Error(`Failed to download AI runner asset: HTTP ${response.status}`);
  }
  const text = await response.text();
  return `${config.systemPrompt}\n\n--- Strategy file ---\n${text}`;
}

function ensureRunScopedState(config: RunnerEnv): void {
  const stateDir = path.join(os.tmpdir(), "openclaw-ai-runner", config.runId);
  process.env.OPENCLAW_STATE_DIR = stateDir;
  process.env.OPENCLAW_CONFIG_PATH = path.join(stateDir, "openclaw.json");
}

export async function prepareRunnerConfig(config: RunnerEnv): Promise<string> {
  ensureRunScopedState(config);
  await fs.mkdir(process.env.OPENCLAW_STATE_DIR!, { recursive: true, mode: 0o700 });

  const [{ writeCredentials }, { wireMcpServer }] = await Promise.all([
    import("./src/credentials.js"),
    import("./src/mcp-wiring.js"),
  ]);

  const creds = {
    user_id: process.env["PLATFORM_AGENT_USER_ID"]?.trim() || `runner-${config.runId}`,
    api_key: config.platformApiKey,
    signing_key_id: "runner-managed",
    signing_private_key: "runner-managed",
    display_name: `ai-runner-${config.runId.slice(0, 8)}`,
    deposit_address: process.env["PLATFORM_AGENT_DEPOSIT_ADDRESS"]?.trim() || "",
    platform_url: config.platformUrl,
  };
  await writeCredentials(creds);
  await wireMcpServer(creds);

  return buildAutoTask(config, await appendAssetPrompt(config));
}

export function buildAgentArgs(config: RunnerEnv, message: string): string[] {
  return [
    "openclaw.mjs",
    "agent",
    "--local",
    "--session-key",
    `agent:main:ai-runner-${config.runId}`,
    "--message",
    message,
    "--model",
    `${config.llmProvider}/${config.llmModel}`,
    "--tools",
    RUNNER_ALLOWED_TOOLS.join(","),
    "--timeout",
    String(config.maxDurationSeconds),
  ];
}

export async function main(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const config = readRunnerEnv(env);
  applyProviderEnv(config, env);
  logRunnerEvent("ai_runner_starting", {
    run_id: config.runId,
    provider: config.llmProvider,
    model: config.llmModel,
    runtime_mode: config.runtimeMode,
    max_duration_seconds: config.maxDurationSeconds,
  });
  const message = await prepareRunnerConfig(config);
  logRunnerEvent("ai_runner_configured", { run_id: config.runId });
  const child = spawn(process.execPath, buildAgentArgs(config, message), {
    stdio: "inherit",
    env,
  });
  return await new Promise<number>((resolve) => {
    child.once("exit", (code) => {
      logRunnerEvent("ai_runner_exited", { run_id: config.runId, exit_code: code ?? 1 });
      resolve(code ?? 1);
    });
    child.once("error", () => {
      logRunnerEvent("ai_runner_spawn_failed", { run_id: config.runId });
      resolve(1);
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error(
        `AI runner entrypoint failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    });
}
