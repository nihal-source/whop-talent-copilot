import {
  IntroGraph,
  normalizeName,
  rankIntroPaths,
  type Edge,
  type ImportedContact,
  type IntroPath,
  type Person,
  type ScoringContext,
} from "./shared";
import { getStore } from "./store";
import type { Session } from "./auth";
import type { IntroRequest } from "./types";

/** Rebuild the org's full graph in memory from persisted persons + edges. */
export async function buildGraph(orgId: string): Promise<IntroGraph> {
  const store = await getStore();
  const graph = new IntroGraph();
  for (const person of await store.listPersons(orgId)) graph.loadPerson(person);
  for (const edge of await store.listEdges(orgId)) graph.loadEdge(edge);
  return graph;
}

/**
 * Ensure the signed-in teammate has a person node representing themselves. This
 * node is the root of every intro path their data contributes.
 */
export async function ensureSelfPerson(session: Session): Promise<string> {
  const store = await getStore();
  if (session.user.personId) return session.user.personId;
  const person: Person = {
    id: `person_self_${session.user.id}`,
    name: session.user.name,
    normalizedName: normalizeName(session.user.name),
    accounts: [],
    resolution: "user_confirmed",
    resolutionConfidence: 1,
  };
  await store.upsertPerson(session.org.id, person);
  await store.setUserPerson(session.org.id, session.user.id, person.id);
  return person.id;
}

/**
 * Ingest a teammate's parsed export into the shared graph. Reuses IntroGraph's
 * handle-based identity resolution, then persists new persons + edges. Only the
 * signed-in user's own data is written, tagged with their user id for opt-out
 * cascade deletes.
 */
export async function ingestContacts(
  session: Session,
  contacts: ImportedContact[],
): Promise<{ added: number; merged: number; ambiguities: number }> {
  const store = await getStore();
  const selfId = await ensureSelfPerson(session);
  const graph = await buildGraph(session.org.id);
  // Make sure the self node exists in the in-memory graph too.
  if (!graph.getPerson(selfId)) {
    graph.loadPerson({
      id: selfId,
      name: session.user.name,
      normalizedName: normalizeName(session.user.name),
      accounts: [],
      resolution: "user_confirmed",
      resolutionConfidence: 1,
    });
  }

  const beforeEdgeIds = new Set(graph.allEdges().map((e) => e.id));
  const result = graph.ingestContacts(selfId, session.user.id, contacts);

  // Persist every person (idempotent upsert) and only the newly created edges.
  for (const person of graph.allPersons()) {
    await store.upsertPerson(session.org.id, person);
  }
  const newEdges = graph.allEdges().filter((e) => !beforeEdgeIds.has(e.id));
  await store.addEdges(session.org.id, newEdges);

  return { ...result, ambiguities: graph.ambiguities.length };
}

/** Persist a single inferred/manual edge (e.g. PDL coworker overlap, orbit contact). */
export async function addInferredEdge(session: Session, edge: Omit<Edge, "id">): Promise<void> {
  const store = await getStore();
  const id = `edge_${Math.random().toString(36).slice(2, 10)}`;
  await store.addEdges(session.org.id, [{ ...edge, id }]);
}

/** Build the scoring context from team membership, consent, and intro outcomes. */
async function buildScoringContext(orgId: string): Promise<ScoringContext> {
  const store = await getStore();
  const users = await store.listUsers(orgId);
  const consents = await store.listConsents(orgId);
  const requests = await store.listIntroRequests(orgId);

  const teamMemberIds = new Set<string>();
  const userIdToPerson = new Map<string, string>();
  for (const u of users) {
    if (u.personId) {
      teamMemberIds.add(u.personId);
      userIdToPerson.set(u.id, u.personId);
    }
  }

  const optedInIds = new Set<string>();
  for (const c of consents) {
    if (c.introMakerOptIn) {
      const pid = userIdToPerson.get(c.userId);
      if (pid) optedInIds.add(pid);
    }
  }

  return {
    teamMemberIds,
    optedInIds,
    responsivenessById: responsivenessFrom(requests),
    freshnessTtlDays: 90,
  };
}

/** Connector responsiveness = accepted / (accepted + declined + no_response). */
function responsivenessFrom(requests: IntroRequest[]): Map<string, number> {
  const tally = new Map<string, { good: number; total: number }>();
  for (const r of requests) {
    if (r.status === "queued") continue;
    const t = tally.get(r.connectorPersonId) ?? { good: 0, total: 0 };
    t.total += 1;
    if (r.status === "accepted") t.good += 1;
    tally.set(r.connectorPersonId, t);
  }
  const out = new Map<string, number>();
  for (const [id, t] of tally) out.set(id, t.total ? t.good / t.total : 0.5);
  return out;
}

export interface RankedPaths {
  target: Person | null;
  paths: IntroPath[];
  /** id -> display name for every person referenced in the paths (connectors, via-teammates, target). */
  names: Record<string, string>;
}

export async function rankPathsForTarget(
  orgId: string,
  targetId: string,
  overrides: Partial<ScoringContext> = {},
): Promise<RankedPaths> {
  const graph = await buildGraph(orgId);
  addInferredCoworkerEdges(graph, targetId);
  const ctx = { ...(await buildScoringContext(orgId)), ...overrides };
  const paths = rankIntroPaths(graph, targetId, ctx);

  const names: Record<string, string> = {};
  const record = (id: string) => {
    const p = graph.getPerson(id);
    if (p) names[id] = p.name;
  };
  record(targetId);
  for (const path of paths) {
    record(path.connectorId);
    record(path.viaTeamMemberId);
  }

  return { target: graph.getPerson(targetId) ?? null, paths, names };
}

/**
 * Add transient (non-persisted) coworker_inferred edges from anyone at the
 * target's current company to the target. This is the only inference we surface:
 * it is always labeled "likely", capped low, and must clear a higher score bar
 * than confirmed edges. Persisted data stays purely confirmed.
 */
function addInferredCoworkerEdges(graph: IntroGraph, targetId: string): void {
  const target = graph.getPerson(targetId);
  if (!target?.company) return;
  const company = target.company.toLowerCase().trim();
  const now = new Date().toISOString();
  for (const person of graph.allPersons()) {
    if (person.id === targetId) continue;
    if (!person.company) continue;
    if (person.company.toLowerCase().trim() !== company) continue;
    graph.loadEdge({
      id: `edge_inferred_${person.id}_${targetId}`,
      fromPersonId: person.id,
      toPersonId: targetId,
      type: "coworker_inferred",
      source: "pdl_inferred",
      confidence: 0.3,
      evidence: [
        { kind: "shared_employer", platform: "linkedin", rawRef: target.company },
      ],
      contributedBy: "system_inference",
      observedAt: now,
    });
  }
}
