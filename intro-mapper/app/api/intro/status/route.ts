import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getStore } from "@/lib/store";
import type { IntroRequestStatus } from "@/lib/types";

const VALID: IntroRequestStatus[] = ["queued", "sent", "accepted", "declined", "no_response"];

/** Update an intro request outcome. Accepted/declined feed the responsiveness score. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { id, status } = body as { id?: string; status?: IntroRequestStatus };
  if (!id || !status || !VALID.includes(status)) {
    return NextResponse.json({ error: "valid id and status are required" }, { status: 400 });
  }
  const store = await getStore();
  await store.updateIntroRequestStatus(session.org.id, id, status);
  return NextResponse.json({ ok: true });
}
