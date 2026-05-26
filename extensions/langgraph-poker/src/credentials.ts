import fs from "node:fs/promises";
import path from "node:path";
import { CONFIG_DIR } from "openclaw/plugin-sdk/setup-tools";

export type PokerCredentials = {
  user_id: string;
  api_key: string;
  signing_key_id: string;
  signing_private_key: string;
  display_name: string;
  deposit_address: string;
  platform_url: string;
};

export function credentialsPath(): string {
  return path.join(CONFIG_DIR, "langgraph-poker-credentials.json");
}

export async function readCredentials(): Promise<PokerCredentials | null> {
  try {
    const raw = await fs.readFile(credentialsPath(), "utf-8");
    return JSON.parse(raw) as PokerCredentials;
  } catch {
    return null;
  }
}

export async function writeCredentials(creds: PokerCredentials): Promise<void> {
  const filePath = credentialsPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  // mode 0o600: owner read/write only — these are live API keys
  await fs.writeFile(filePath, JSON.stringify(creds, null, 2) + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });
}

export async function deleteCredentials(): Promise<void> {
  try {
    await fs.unlink(credentialsPath());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }
}
