import { mutateConfigFile } from "openclaw/plugin-sdk/config-mutation";
import type { PokerCredentials } from "./credentials.js";

const SERVER_KEY = "langgraph-poker";

export async function wireMcpServer(creds: PokerCredentials): Promise<void> {
  await mutateConfigFile({
    mutate(draft) {
      draft.mcp ??= {};
      draft.mcp.servers ??= {};
      draft.mcp.servers[SERVER_KEY] = {
        url: `${creds.platform_url}/mcp/`,
        // streamable-http is the preferred MCP HTTP transport
        transport: "streamable-http",
        headers: {
          Authorization: `Bearer ${creds.api_key}`,
        },
      };
    },
  });
}

export async function removeMcpServer(): Promise<void> {
  await mutateConfigFile({
    mutate(draft) {
      if (draft.mcp?.servers && SERVER_KEY in draft.mcp.servers) {
        delete draft.mcp.servers[SERVER_KEY];
      }
    },
  });
}

export async function isMcpServerWired(): Promise<boolean> {
  // We can't read the live runtime config from inside a tool call, so we check
  // credentials as a proxy — if they exist, wiring was completed at setup time.
  return false; // caller should check credentials instead; this exists for future use
}
