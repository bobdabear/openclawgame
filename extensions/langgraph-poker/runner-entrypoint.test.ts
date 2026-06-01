import { describe, expect, it } from "vitest";
import {
  applyProviderEnv,
  buildAgentArgs,
  buildAutoTask,
  buildContinuationTask,
  formatRunnerLog,
  readRunnerEnv,
  RUNNER_ALLOWED_TOOLS,
  type RunnerEnv,
} from "./runner-entrypoint.js";

function baseEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    RUN_ID: "run-1",
    LANGGRAPH_POKER_URL: "https://platform.example/",
    PLATFORM_API_KEY: "agk_test_value",
    LLM_PROVIDER: "openai",
    LLM_MODEL: "gpt-4o",
    LLM_API_KEY: "sk_test_value",
    SYSTEM_PROMPT: "Play carefully.",
    MAX_DURATION_SECONDS: "600",
    ...overrides,
  };
}

function baseConfig(overrides: Partial<RunnerEnv> = {}): RunnerEnv {
  return {
    runId: "run-1",
    platformUrl: "https://platform.example",
    platformApiKey: "agk_test_value",
    llmProvider: "openai",
    llmModel: "gpt-4o",
    llmApiKey: "sk_test_value",
    systemPrompt: "Play carefully.",
    assetS3Url: "",
    runtimeMode: "job",
    maxDurationSeconds: 600,
    agentOnlyTable: true,
    ...overrides,
  };
}

describe("langgraph-poker runner entrypoint", () => {
  it("normalizes required runner environment", () => {
    const config = readRunnerEnv(baseEnv({ AGENT_ONLY_TABLE: "false" }));

    expect(config.platformUrl).toBe("https://platform.example");
    expect(config.maxDurationSeconds).toBe(600);
    expect(config.agentOnlyTable).toBe(false);
  });

  it("rejects missing required values", () => {
    const env = baseEnv({ SYSTEM_PROMPT: "" });

    expect(() => readRunnerEnv(env)).toThrow(/SYSTEM_PROMPT/);
  });

  it("maps provider keys without logging or changing key text", () => {
    const env: NodeJS.ProcessEnv = {};

    applyProviderEnv(baseConfig({ llmProvider: "anthropic", llmApiKey: "secret-value" }), env);

    expect(env.ANTHROPIC_API_KEY).toBe("secret-value");
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it("builds a bounded poker auto-task", () => {
    const task = buildAutoTask(baseConfig(), "Play tight-aggressive.");

    expect(task).toContain("Run id: run-1");
    expect(task).toContain("Prefer agent-only Hold'em tables");
    expect(task).toContain("Play tight-aggressive.");
  });

  it("builds a continuation task that forces immediate tool use", () => {
    const task = buildContinuationTask(baseConfig(), 2, 570);

    expect(task).toContain("previous agent turn exited before the paid run duration elapsed");
    expect(task).toContain("Continuation attempt: 2");
    expect(task).toContain("Perform the next tool call now");
    expect(task).toContain("ready_next_hand");
    expect(task).toContain("submit_action");
  });

  it("builds local agent CLI args with session, model, and timeout", () => {
    const args = buildAgentArgs(baseConfig(), "play now");

    expect(args).toEqual([
      "openclaw.mjs",
      "agent",
      "--local",
      "--session-key",
      "agent:main:ai-runner-run-1",
      "--message",
      "play now",
      "--model",
      "openai/gpt-4o",
      "--tools",
      RUNNER_ALLOWED_TOOLS.join(","),
      "--timeout",
      "600",
    ]);
    expect(RUNNER_ALLOWED_TOOLS).toContain("langgraph-poker__get_account_info");
    expect(RUNNER_ALLOWED_TOOLS).toContain("get_account_info");
  });

  it("lets continuation turns use the remaining runtime as timeout", () => {
    const args = buildAgentArgs(baseConfig(), "continue", 42);

    expect(args.at(-1)).toBe("42");
  });

  it("formats structured logs with secret redaction", () => {
    const line = formatRunnerLog("test_event", { token: "agk_secretvalue123456" });
    const parsed = JSON.parse(line) as { event: string; token: string; ts: string };

    expect(parsed.event).toBe("test_event");
    expect(parsed.token).toBe("[REDACTED]");
    expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
