import { NextResponse } from "next/server";
import { getSession, mintToken } from "@/lib/auth";

/**
 * Returns a bearer token for the current browser session, for pasting into the
 * Chrome extension. Reading it requires an active cookie session.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  return NextResponse.json({ token: mintToken(session), org: session.org.name, user: session.user.name });
}
