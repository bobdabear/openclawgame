import type { PokerCredentials } from "./credentials.js";

type RegistrationApiResponse = {
  user_id: string;
  api_key: string;
  deposit_address: string;
  display_name: string;
  tron_realm: string;
  signing_key_id: string;
  signing_private_key: string;
};

export async function registerAgent(params: {
  platformUrl: string;
  displayName: string;
}): Promise<PokerCredentials> {
  const url = `${params.platformUrl}/api/v1/ai/register`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: params.displayName }),
    });
  } catch (err) {
    throw new Error(
      `Could not reach the poker platform at ${params.platformUrl}. ` +
        `Check that the platform is running and LANGGRAPH_POKER_URL is correct. ` +
        `Original error: ${(err as Error).message}`,
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Registration failed with HTTP ${response.status}. ` +
        (body ? `Server said: ${body.slice(0, 300)}` : "No response body."),
    );
  }

  const data = (await response.json()) as RegistrationApiResponse;

  if (!data.api_key || !data.signing_private_key) {
    throw new Error(
      "Registration response was missing api_key or signing_private_key. " +
        "The platform may be running an incompatible version.",
    );
  }

  return {
    user_id: data.user_id,
    api_key: data.api_key,
    signing_key_id: data.signing_key_id,
    signing_private_key: data.signing_private_key,
    display_name: data.display_name,
    deposit_address: data.deposit_address,
    platform_url: params.platformUrl,
  };
}
