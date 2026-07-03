import { createHash, randomBytes } from "node:crypto";

/**
 * X (Twitter) OAuth 2.0 PKCE helpers. Scopes are kept minimal: read-only access
 * to the user's own follows so we can build their follower/following edges.
 * No write scopes, no DM scope by default.
 */
export const X_SCOPES = ["tweet.read", "users.read", "follows.read", "offline.access"];

export function xConfigured(): boolean {
  return !!(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET && process.env.X_REDIRECT_URI);
}

export function makePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function authorizeUrl(state: string, challenge: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.X_CLIENT_ID!,
    redirect_uri: process.env.X_REDIRECT_URI!,
    scope: X_SCOPES.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
}

export async function exchangeCode(code: string, verifier: string): Promise<string> {
  const basic = Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.X_REDIRECT_URI!,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`X token exchange failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

interface XUserResponse {
  data?: { id: string };
}
interface XFollowsResponse {
  data?: Array<{ id: string; username: string; name: string }>;
  meta?: { next_token?: string };
}

async function xGet<T>(token: string, url: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`X API error: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export async function fetchMe(token: string): Promise<string> {
  const body = await xGet<XUserResponse>(token, "https://api.twitter.com/2/users/me");
  if (!body.data?.id) throw new Error("Could not resolve X user id");
  return body.data.id;
}

/**
 * Page through followers or following. Capped to avoid runaway metered reads —
 * rate/cost control is a compliance and budget requirement, not optional.
 */
export async function fetchFollows(
  token: string,
  userId: string,
  direction: "following" | "followers",
  maxPages = 5,
): Promise<Array<{ id: string; username: string; name: string }>> {
  const out: Array<{ id: string; username: string; name: string }> = [];
  let nextToken: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({ max_results: "1000" });
    if (nextToken) params.set("pagination_token", nextToken);
    const body = await xGet<XFollowsResponse>(
      token,
      `https://api.twitter.com/2/users/${userId}/${direction}?${params.toString()}`,
    );
    out.push(...(body.data ?? []));
    nextToken = body.meta?.next_token;
    if (!nextToken) break;
  }
  return out;
}
