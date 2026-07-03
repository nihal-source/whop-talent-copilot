import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getStore } from "@/lib/store";
import { buildGraph, rankPathsForTarget } from "@/lib/graph-service";
import { buildIntroFacts, draftIntroRequest, validateIntroDraft } from "@/lib/shared";
import type { IntroRequest } from "@/lib/types";

/** Create a queued intro request with a grounded, validated draft ask. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { targetId, connectorId, purpose } = body as {
    targetId?: string;
    connectorId?: string;
    purpose?: string;
  };
  if (!targetId || !connectorId) {
    return NextResponse.json({ error: "targetId and connectorId are required" }, { status: 400 });
  }

  const ranked = await rankPathsForTarget(session.org.id, targetId);
  const path = ranked.paths.find((p) => p.connectorId === connectorId);
  if (!path) {
    return NextResponse.json({ error: "no viable path for that connector" }, { status: 404 });
  }

  const graph = await buildGraph(session.org.id);
  const facts = buildIntroFacts(graph, path);
  const draft = draftIntroRequest(facts, purpose ?? "");
  const validation = validateIntroDraft(draft, facts);

  const store = await getStore();
  const request: IntroRequest = {
    id: `intro_${Math.random().toString(36).slice(2, 10)}`,
    orgId: session.org.id,
    targetPersonId: targetId,
    connectorPersonId: connectorId,
    requestedBy: session.user.id,
    status: "queued",
    draft,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await store.createIntroRequest(request);

  return NextResponse.json({ request, draft, facts, validation });
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const store = await getStore();
  const [requests, persons] = await Promise.all([
    store.listIntroRequests(session.org.id),
    store.listPersons(session.org.id),
  ]);
  const nameById = new Map(persons.map((p) => [p.id, p.name]));
  const enriched = requests.map((r) => ({
    ...r,
    targetName: nameById.get(r.targetPersonId) ?? "Unknown",
    connectorName: nameById.get(r.connectorPersonId) ?? "Unknown",
  }));
  return NextResponse.json({ requests: enriched });
}
