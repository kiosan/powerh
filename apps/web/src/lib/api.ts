export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  // Only set Content-Type when there's a body. Fastify rejects requests with
  // Content-Type: application/json + no body, so DELETE/GET would fail otherwise.
  const hasBody = init?.body != null;
  const headers: Record<string, string> = {
    ...((init?.headers as Record<string, string> | undefined) ?? {}),
  };
  if (hasBody && !("Content-Type" in headers) && !("content-type" in headers)) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`/api${path}`, {
    ...init,
    headers,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

export interface SetupStatus {
  configured: { anthropic: boolean; strava: boolean };
  model: string;
  hasAnthropicKey: boolean;
  hasStravaClientId: boolean;
  hasStravaClientSecret: boolean;
}
