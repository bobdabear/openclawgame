import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import { Type } from "typebox";
import { resolvePlatformUrl, type PokerPluginConfig } from "./src/config.js";
import { readCredentials, writeCredentials, deleteCredentials } from "./src/credentials.js";
import { wireMcpServer, removeMcpServer } from "./src/mcp-wiring.js";
import { registerAgent } from "./src/registration.js";

const ConfigSchema = Type.Object(
  {
    platformUrl: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export default defineToolPlugin({
  id: "langgraph-poker",
  name: "LangGraph Poker",
  description:
    "Connect to the LangGraph TRX poker platform. Registers an AI agent account, wires the MCP server, and exposes setup/status/reset management tools.",
  activation: { onStartup: true },
  configSchema: ConfigSchema,

  tools: (tool) => [
    tool({
      name: "poker_setup",
      description:
        "Register a new AI agent account on the LangGraph TRX poker platform and configure the MCP server connection. " +
        "Run this once before playing. After completion you must restart OpenClaw for the poker MCP tools " +
        "(get_game_state, submit_action, list_tables, etc.) to become active.",
      parameters: Type.Object({
        display_name: Type.String({
          description:
            "Public display name for your agent on the platform leaderboard and table (1–34 chars, letters/numbers/spaces/underscore/dash).",
          minLength: 1,
          maxLength: 34,
        }),
        platform_url: Type.Optional(
          Type.String({
            description:
              "Override the platform base URL for this registration. " +
              "Leave blank to use the plugin config or LANGGRAPH_POKER_URL env var.",
          }),
        ),
      }),
      execute: async (params, config: PokerPluginConfig) => {
        const existing = await readCredentials();
        if (existing) {
          return [
            "Already configured — credentials exist for this agent.",
            `  Display name : ${existing.display_name}`,
            `  User ID      : ${existing.user_id}`,
            `  Platform     : ${existing.platform_url}`,
            `  Deposit addr : ${existing.deposit_address}`,
            "",
            "The MCP server was wired at setup time. If poker tools are missing, restart OpenClaw.",
            "To register a new account, run poker_reset first (this discards the current account).",
          ].join("\n");
        }

        const platformUrl = resolvePlatformUrl(config, params.platform_url);

        let creds;
        try {
          creds = await registerAgent({ platformUrl, displayName: params.display_name });
        } catch (err) {
          return `Registration failed: ${(err as Error).message}`;
        }

        try {
          await writeCredentials(creds);
        } catch (err) {
          return (
            `Registration succeeded but credentials could not be saved: ${(err as Error).message}\n` +
            `Your API key (save this — it will not be shown again): ${creds.api_key}`
          );
        }

        try {
          await wireMcpServer(creds);
        } catch (err) {
          return [
            "Registration succeeded and credentials saved, but MCP wiring failed.",
            `Error: ${(err as Error).message}`,
            "",
            "You can wire manually by adding this to your openclaw.json under mcp.servers:",
            JSON.stringify(
              {
                "langgraph-poker": {
                  url: `${platformUrl}/mcp`,
                  transport: "streamable-http",
                  headers: { Authorization: `Bearer ${creds.api_key}` },
                },
              },
              null,
              2,
            ),
          ].join("\n");
        }

        return [
          "Setup complete.",
          `  Display name : ${creds.display_name}`,
          `  User ID      : ${creds.user_id}`,
          `  Platform     : ${creds.platform_url}`,
          `  Deposit addr : ${creds.deposit_address}`,
          "",
          "IMPORTANT: Restart OpenClaw now to activate the poker MCP tools.",
          "After restart, use list_tables, join_table, get_game_state, submit_action, and the other poker tools.",
          "",
          "To fund your account, send TRX to the deposit address above.",
        ].join("\n");
      },
    }),

    tool({
      name: "poker_status",
      description:
        "Check whether poker platform credentials are configured and the MCP server is wired. " +
        "Run this if you are unsure whether setup has already been completed.",
      parameters: Type.Object({}),
      execute: async (_params, _config: PokerPluginConfig) => {
        const creds = await readCredentials();
        if (!creds) {
          return [
            "Not configured.",
            "Run poker_setup to register an account and wire the MCP server.",
          ].join("\n");
        }
        return [
          "Configured.",
          `  Display name : ${creds.display_name}`,
          `  User ID      : ${creds.user_id}`,
          `  Platform     : ${creds.platform_url}`,
          `  Deposit addr : ${creds.deposit_address}`,
          "",
          "MCP server wired. If poker tools are not available in your tool list, restart OpenClaw.",
        ].join("\n");
      },
    }),

    tool({
      name: "poker_reset",
      description:
        "Remove stored credentials and unwire the MCP server. " +
        "Use this to switch accounts or recover from a broken setup. " +
        "The current account on the platform is NOT deleted — only local credentials are cleared.",
      parameters: Type.Object({
        confirm: Type.Boolean({
          description: "Must be true to proceed. Prevents accidental credential removal.",
        }),
      }),
      execute: async (params, _config: PokerPluginConfig) => {
        if (!params.confirm) {
          return "Set confirm: true to remove local credentials and unwire the MCP server.";
        }

        const existing = await readCredentials();
        if (!existing) {
          return "Nothing to reset — no credentials are stored.";
        }

        const errors: string[] = [];

        try {
          await removeMcpServer();
        } catch (err) {
          errors.push(`MCP unwire failed: ${(err as Error).message}`);
        }

        try {
          await deleteCredentials();
        } catch (err) {
          errors.push(`Credential deletion failed: ${(err as Error).message}`);
        }

        if (errors.length > 0) {
          return ["Reset completed with errors:", ...errors.map((e) => `  ${e}`)].join("\n");
        }

        return [
          "Reset complete. Local credentials removed and MCP server unwired.",
          "Run poker_setup to register a new account, then restart OpenClaw.",
        ].join("\n");
      },
    }),
  ],
});
