import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { getSession } from "@/lib/auth";
import { authorizeUrl, makePkce, xConfigured } from "@/lib/x-oauth";

/** Begin the X OAuth 2.0 PKCE flow. Stashes verifier + state in httpOnly cookies. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!xConfigured()) {
    return NextResponse.json({ error: "X OAuth not configured" }, { status: 501 });
  }

  const { verifier, challenge } = makePkce();
  const state = randomBytes(16).toString("hex");
  const jar = cookies();
  const opts = { httpOnly: true as const, sameSite: "lax" as const, path: "/", maxAge: 600 };
  jar.set("x_pkce", verifier, opts);
  jar.set("x_state", state, opts);

  return NextResponse.redirect(authorizeUrl(state, challenge));
}
