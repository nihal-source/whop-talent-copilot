import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getStore } from "@/lib/store";

/** Team roster with per-member consent + graph contribution + data freshness. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const store = await getStore();
  const [users, consents, edges, persons] = await Promise.all([
    store.listUsers(session.org.id),
    store.listConsents(session.org.id),
    store.listEdges(session.org.id),
    store.listPersons(session.org.id),
  ]);

  const consentByUser = new Map(consents.map((c) => [c.userId, c]));
  const now = Date.now();
  const members = users.map((u) => {
    const contributed = edges.filter((e) => e.contributedBy === u.id);
    const newest = contributed.reduce<number>((max, e) => {
      const t = new Date(e.observedAt).getTime();
      return t > max ? t : max;
    }, 0);
    const consent = consentByUser.get(u.id);
    const staleDays = newest ? Math.floor((now - newest) / 86_400_000) : null;
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      shareWithTeam: consent?.shareWithTeam ?? false,
      introMakerOptIn: consent?.introMakerOptIn ?? false,
      edgeCount: contributed.length,
      lastSyncDays: staleDays,
      stale: staleDays != null && staleDays > 90,
    };
  });

  return NextResponse.json({
    org: session.org,
    members,
    totals: { persons: persons.length, edges: edges.length },
  });
}
