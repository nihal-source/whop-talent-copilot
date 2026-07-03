import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getStore } from "./store";
import type { Org, User } from "./types";

/**
 * Lightweight team auth for v1: a signed, httpOnly session cookie carrying the
 * org + user. This intentionally has no password store — it is dev/team auth
 * scoped by org, and is the single seam to replace with Clerk (swap the
 * signIn/getSession internals; the rest of the app only calls getSession).
 */

const COOKIE = "im_session";

interface SessionPayload {
  orgId: string;
  userId: string;
}

function secret(): string {
  return process.env.SESSION_SECRET || "dev-insecure-secret-set-SESSION_SECRET";
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

function encode(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

function decode(token: string): SessionPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
  } catch {
    return null;
  }
}

export interface Session {
  org: Org;
  user: User;
}

/**
 * Mint a bearer token for out-of-browser clients (the Chrome extension). It uses
 * the same signed payload as the cookie, so no separate token store is needed.
 */
export function mintToken(session: Session): string {
  return encode({ orgId: session.org.id, userId: session.user.id });
}

async function sessionFromPayload(payload: SessionPayload | null): Promise<Session | null> {
  if (!payload) return null;
  const store = await getStore();
  const org = await store.getOrg(payload.orgId);
  const user = org ? await store.getUser(payload.orgId, payload.userId) : null;
  if (!org || !user) return null;
  return { org, user };
}

/** Resolve a session from a bearer token (extension) or the session cookie. */
export async function resolveSession(req: Request): Promise<Session | null> {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    return sessionFromPayload(decode(auth.slice(7).trim()));
  }
  return getSession();
}

/** Create/lookup the org + user and set the session cookie. */
export async function signIn(orgName: string, email: string, name: string): Promise<Session> {
  const store = await getStore();
  const org = await store.ensureOrg(orgName.trim());
  const user = await store.upsertUser(org.id, email.trim().toLowerCase(), name.trim() || email);
  cookies().set(COOKIE, encode({ orgId: org.id, userId: user.id }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return { org, user };
}

export function signOut(): void {
  cookies().delete(COOKIE);
}

export async function getSession(): Promise<Session | null> {
  const token = cookies().get(COOKIE)?.value;
  if (!token) return null;
  return sessionFromPayload(decode(token));
}

/** Throws when unauthenticated — for use in API routes. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new Error("UNAUTHENTICATED");
  return session;
}
