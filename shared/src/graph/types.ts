/**
 * Warm-intro graph model. Every relationship carries provenance so the UI can
 * separate confirmed edges (from a user's own export/OAuth) from inferred edges
 * (PDL coworker overlap). This separation is what keeps intro suggestions honest
 * and prevents hallucinated "mutual connection" claims.
 */

export type Platform = "linkedin" | "x" | "instagram";

/** A social handle/URL for a person on one platform. */
export interface PlatformAccount {
  platform: Platform;
  /** Normalized identifier: linkedin vanity slug, x handle (no @), ig username. */
  handle: string;
  /** Canonical profile URL when known. */
  url?: string;
}

/** Canonical identity for a node in the graph (PDL-resolved or manually added). */
export interface Person {
  id: string;
  name: string;
  /** Lowercased normalized name used for fuzzy matching. */
  normalizedName: string;
  accounts: PlatformAccount[];
  company?: string;
  title?: string;
  location?: string;
  /** How this identity was established. */
  resolution: "pdl" | "export" | "user_confirmed";
  /** 0-1 confidence in the identity resolution itself (PDL match likelihood). */
  resolutionConfidence: number;
}

export type EdgeType =
  | "connection"
  | "follows"
  | "followed_by"
  | "coworker_inferred"
  | "manual";

export type EdgeSource =
  | "linkedin_export"
  | "linkedin_dma"
  | "x_oauth"
  | "x_export"
  | "ig_export"
  | "pdl_inferred"
  | "user_confirmed";

export type InteractionKind =
  | "comment"
  | "like"
  | "repost"
  | "reply"
  | "message"
  | "shared_employer";

/**
 * Evidence backing an edge. Only ever populated from a user's own export/OAuth
 * data. We store metadata (kind, timestamp, a pointer) rather than full content
 * to respect data minimization.
 */
export interface InteractionEvidence {
  kind: InteractionKind;
  platform: Platform;
  timestamp?: string;
  /** Pointer/summary, never the raw message body. */
  rawRef?: string;
}

/**
 * A directed relationship: `fromPersonId` (a teammate or their contact) relates
 * to `toPersonId` (a contact or target). Confirmed edges come from exports/OAuth;
 * inferred edges come from PDL and must be labeled as such in any UI.
 */
export interface Edge {
  id: string;
  fromPersonId: string;
  toPersonId: string;
  type: EdgeType;
  source: EdgeSource;
  /** 0-1. Confirmed sources are high; pdl_inferred is capped low. */
  confidence: number;
  evidence: InteractionEvidence[];
  /** Which teammate's data surfaced this edge (for merge + cascade delete). */
  contributedBy: string;
  /** ISO timestamp of the sync/import that produced this edge. */
  observedAt: string;
}

/** Whether an edge is directly attested or statistically inferred. */
export type EdgeVeracity = "confirmed" | "likely";

/** Source-of-truth for which sources count as confirmed vs inferred. */
export const CONFIRMED_SOURCES: ReadonlySet<EdgeSource> = new Set<EdgeSource>([
  "linkedin_export",
  "linkedin_dma",
  "x_oauth",
  "x_export",
  "ig_export",
  "user_confirmed",
]);

export function edgeVeracity(edge: Pick<Edge, "source">): EdgeVeracity {
  return CONFIRMED_SOURCES.has(edge.source) ? "confirmed" : "likely";
}

/** Upper bound on confidence for inferred edges so they never outrank confirmed ones. */
export const MAX_INFERRED_CONFIDENCE = 0.5;
