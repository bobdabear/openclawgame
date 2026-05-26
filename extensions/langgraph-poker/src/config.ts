export const DEFAULT_PLATFORM_URL = process.env["LANGGRAPH_POKER_URL"] ?? "http://localhost:8000";

export type PokerPluginConfig = {
  platformUrl?: string;
};

export function resolvePlatformUrl(pluginConfig: PokerPluginConfig, override?: string): string {
  const url = override?.trim() || pluginConfig.platformUrl?.trim() || DEFAULT_PLATFORM_URL;
  return url.replace(/\/$/, "");
}
