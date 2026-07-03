import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getStore } from "@/lib/store";

/**
 * Opt-out / right-to-delete: removes all edges the signed-in user contributed to
 * the team graph and clears their sharing consent. Cascades so any path that
 * relied solely on their data disappears on the next query.
 */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const store = await getStore();
  const removed = await store.removeEdgesByContributor(session.org.id, session.user.id);
  await store.setConsent({
    orgId: session.org.id,
    userId: session.user.id,
    shareWithTeam: false,
    introMakerOptIn: false,
    retentionDays: 0,
    consentedAt: new Date().toISOString(),
  });
  return NextResponse.json({ ok: true, removedEdges: removed });
}
