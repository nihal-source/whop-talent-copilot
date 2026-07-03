import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { getStore } from "@/lib/store";
import { ingestContacts } from "@/lib/graph-service";
import { normalizeXApiFollows } from "@/lib/shared";
import { exchangeCode, fetchFollows, fetchMe } from "@/lib/x-oauth";

/**
 * X OAuth callback: exchange the code, pull the user's following + followers, and
 * ingest them as confirmed edges. Requires prior data-sharing consent, matching
 * the upload guardrail.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/", req.url));

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = cookies();
  const verifier = jar.get("x_pkce")?.value;
  const savedState = jar.get("x_state")?.value;
  jar.delete("x_pkce");
  jar.delete("x_state");

  if (!code || !state || !verifier || state !== savedState) {
    return NextResponse.redirect(new URL("/onboarding?x=error", req.url));
  }

  const store = await getStore();
  const consent = await store.getConsent(session.org.id, session.user.id);
  if (!consent?.shareWithTeam) {
    return NextResponse.redirect(new URL("/onboarding?x=consent", req.url));
  }

  try {
    const token = await exchangeCode(code, verifier);
    const me = await fetchMe(token);
    const following = await fetchFollows(token, me, "following");
    const followers = await fetchFollows(token, me, "followers");
    const contacts = [
      ...normalizeXApiFollows(following, "following"),
      ...normalizeXApiFollows(followers, "follower"),
    ];
    await ingestContacts(session, contacts);
    return NextResponse.redirect(new URL("/onboarding?x=ok", req.url));
  } catch {
    return NextResponse.redirect(new URL("/onboarding?x=error", req.url));
  }
}
