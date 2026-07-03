import type { IntroGraph } from "./builder";
import type { Edge, EdgeVeracity, Person } from "./types";
import { edgeVeracity } from "./types";

/**
 * Intro-maker rubric. For a target T, we find candidate connectors C that reach T
 * and rank them. Confirmed edges (export/OAuth) dominate inferred ones (PDL
 * coworker overlap), and a path is suppressed entirely when its only evidence is
 * weak inference — this is the core anti-hallucination guarantee.
 */

export interface RubricWeights {
  closenessToTarget: number;
  credibility: number;
  closenessToYou: number;
  responsiveness: number;
  riskConsent: number;
}

export const DEFAULT_WEIGHTS: RubricWeights = {
  closenessToTarget: 0.4,
  credibility: 0.25,
  closenessToYou: 0.2,
  responsiveness: 0.1,
  riskConsent: 0.05,
};

export const WEIGHT_KEYS: (keyof RubricWeights)[] = [
  "closenessToTarget",
  "credibility",
  "closenessToYou",
  "responsiveness",
  "riskConsent",
];

/**
 * Normalize arbitrary (e.g. user-provided slider) weights so they sum to 1.
 * Keeps the composite on a 0-100 scale regardless of raw input, so the score
 * thresholds (minScore, inferred bar) stay meaningful. Negative values are
 * clamped to 0; an all-zero input falls back to the defaults.
 */
export function normalizeWeights(input: Partial<RubricWeights> | undefined): RubricWeights {
  if (!input) return { ...DEFAULT_WEIGHTS };
  const clamped = WEIGHT_KEYS.map((k) => Math.max(0, Number(input[k]) || 0));
  const sum = clamped.reduce((a, b) => a + b, 0);
  if (sum <= 0) return { ...DEFAULT_WEIGHTS };
  const out = {} as RubricWeights;
  WEIGHT_KEYS.forEach((k, i) => {
    out[k] = clamped[i] / sum;
  });
  return out;
}

/**
 * Relative importance of each interaction signal when computing how close a
 * connector is to the target. These are multipliers on a 0-1 scale (1 = "as
 * strong a signal as we model"), not a probability distribution — they do not
 * need to sum to anything. `follow` scales the weight of a follow-type edge
 * (X/IG following); the rest scale discrete interaction evidence.
 */
export interface SignalWeights {
  comment: number;
  reply: number;
  message: number;
  repost: number;
  like: number;
  /** How much a follow (X/IG) counts relative to a mutual connection. */
  follow: number;
}

export const DEFAULT_SIGNAL_WEIGHTS: SignalWeights = {
  comment: 1,
  reply: 0.9,
  message: 1,
  repost: 0.6,
  like: 0.3,
  follow: 0.5,
};

export const SIGNAL_KEYS: (keyof SignalWeights)[] = [
  "comment",
  "reply",
  "message",
  "repost",
  "like",
  "follow",
];

/** Clamp each signal weight into [0,1]; missing keys fall back to defaults. */
export function normalizeSignalWeights(input: Partial<SignalWeights> | undefined): SignalWeights {
  if (!input) return { ...DEFAULT_SIGNAL_WEIGHTS };
  const out = {} as SignalWeights;
  for (const k of SIGNAL_KEYS) {
    const raw = input[k];
    out[k] = raw == null || Number.isNaN(Number(raw))
      ? DEFAULT_SIGNAL_WEIGHTS[k]
      : Math.min(1, Math.max(0, Number(raw)));
  }
  return out;
}

export interface ScoringContext {
  /** Person IDs of the people you work with (contributors to the graph). */
  teamMemberIds: Set<string>;
  /** Connectors who opted into being shown as intro-makers. */
  optedInIds?: Set<string>;
  /** Past intro success rate per connector, 0-1. */
  responsivenessById?: Map<string, number>;
  /** Relative weights for interaction signals feeding closenessToTarget. */
  signalWeights?: SignalWeights;
  /** Manual credibility ratings, 1-5, per connector. */
  credibilityRatingById?: Map<string, number>;
  weights?: RubricWeights;
  /** Edges older than this many days are treated as stale. */
  freshnessTtlDays?: number;
  /**
   * Minimum composite score (0-100) to surface a path. Also enforces that a
   * purely inferred path must clear a higher bar.
   */
  minScore?: number;
  now?: Date;
}

export interface RubricBreakdown {
  closenessToTarget: number;
  credibility: number;
  closenessToYou: number;
  responsiveness: number;
  riskConsent: number;
  composite: number;
}

export interface IntroPath {
  targetId: string;
  connectorId: string;
  /** Teammate whose network surfaced the connector. Equals connectorId when the connector is a teammate. */
  viaTeamMemberId: string;
  connectorToTarget: Edge;
  teamToConnector?: Edge;
  veracity: EdgeVeracity;
  breakdown: RubricBreakdown;
  evidenceSummary: string[];
}

const SENIOR_TITLE = /\b(founder|ceo|cto|cfo|coo|chief|vp|vice president|partner|principal|head of|director|gm|general manager)\b/i;
const MID_TITLE = /\b(lead|staff|senior|sr\.|manager)\b/i;

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 86_400_000;
}

/** Freshness multiplier: 1.0 when fresh, decaying to 0.5 well past the TTL. */
function freshnessFactor(edge: Edge, ttlDays: number, now: Date): number {
  const age = daysBetween(now, new Date(edge.observedAt));
  if (age <= ttlDays) return 1;
  const over = (age - ttlDays) / ttlDays;
  return Math.max(0.5, 1 - over * 0.5);
}

/** Recency multiplier for a single timestamped signal (1 fresh -> 0.5 stale). */
function recencyFactor(iso: string | undefined, ttlDays: number, now: Date): number {
  if (!iso) return 1;
  const age = daysBetween(now, new Date(iso));
  if (Number.isNaN(age)) return 1;
  if (age <= ttlDays) return 1;
  const over = (age - ttlDays) / ttlDays;
  return Math.max(0.5, 1 - over * 0.5);
}

const INTERACTION_BOOST_CAP = 0.4;
const BREADTH_BONUS_PER_PLATFORM = 0.05;
const BREADTH_BONUS_CAP = 0.1;

/**
 * Closeness of connector to target. Combines three bounded parts:
 *  - base tie: the edge existing (type + confidence), decayed by edge freshness;
 *  - interaction boost: per-signal weighted, per-signal recency-decayed evidence
 *    passed through a saturating curve so a burst of cheap signals (e.g. likes)
 *    can't dominate a genuine relationship;
 *  - breadth bonus: a small lift for engaging across multiple platforms.
 * Interactions can lift a tie but never manufacture one — the whole thing is
 * capped at 1.
 */
function scoreClosenessToTarget(
  edge: Edge,
  sw: SignalWeights,
  ttlDays: number,
  now: Date,
): number {
  const typeWeight =
    edge.type === "connection"
      ? 1
      : edge.type === "follows" || edge.type === "followed_by"
        ? 0.5 + 0.5 * sw.follow
        : edge.type === "coworker_inferred"
          ? 0.4
          : 0.6;

  const base = edge.confidence * typeWeight * freshnessFactor(edge, ttlDays, now);

  let mass = 0;
  const platforms = new Set<string>();
  for (const e of edge.evidence) {
    if (e.kind === "shared_employer") continue;
    const w = (sw as unknown as Record<string, number>)[e.kind];
    if (w == null) continue;
    mass += w * recencyFactor(e.timestamp, ttlDays, now);
    platforms.add(e.platform);
  }
  const interactionBoost = INTERACTION_BOOST_CAP * (1 - Math.exp(-mass));
  const breadthBonus = Math.min(
    Math.max(platforms.size - 1, 0) * BREADTH_BONUS_PER_PLATFORM,
    BREADTH_BONUS_CAP,
  );

  return Math.min(base + interactionBoost + breadthBonus, 1);
}

/** Credibility of the connector as a referrer for this target. */
function scoreCredibility(
  connector: Person,
  target: Person,
  manualRating?: number,
): number {
  let title = 0.3;
  const t = `${connector.title ?? ""}`;
  if (SENIOR_TITLE.test(t)) title = 0.9;
  else if (MID_TITLE.test(t)) title = 0.6;

  // Same company/industry as the target is a relevance signal.
  const sameCompany =
    !!connector.company &&
    !!target.company &&
    connector.company.toLowerCase() === target.company.toLowerCase();
  const relevance = sameCompany ? 0.2 : 0;

  const manual = manualRating != null ? (manualRating - 1) / 4 : null;
  // Manual rating, when present, is weighted heavily; else fall back to inferred.
  return manual != null
    ? Math.min(manual * 0.7 + title * 0.3, 1)
    : Math.min(title + relevance, 1);
}

/** How close the connector is to you/your team. */
function scoreClosenessToYou(
  connectorId: string,
  ctx: ScoringContext,
  teamToConnector: Edge | undefined,
  ttlDays: number,
  now: Date,
): number {
  if (ctx.teamMemberIds.has(connectorId)) return 1;
  if (!teamToConnector) return 0.2;
  return Math.min(teamToConnector.confidence, 1) * freshnessFactor(teamToConnector, ttlDays, now);
}

function scoreRiskConsent(
  connectorId: string,
  ctx: ScoringContext,
  connectorToTarget: Edge,
  ttlDays: number,
  now: Date,
): number {
  const optedIn = ctx.optedInIds ? (ctx.optedInIds.has(connectorId) ? 1 : 0.4) : 0.7;
  const fresh = freshnessFactor(connectorToTarget, ttlDays, now);
  return optedIn * fresh;
}

function summarize(
  connector: Person,
  target: Person,
  connectorToTarget: Edge,
  teamToConnector: Edge | undefined,
  graph: IntroGraph,
): string[] {
  const lines: string[] = [];
  const label =
    connectorToTarget.type === "connection"
      ? "Connected on LinkedIn"
      : connectorToTarget.type === "follows"
        ? `Follows on ${connectorToTarget.evidence[0]?.platform ?? "X/IG"}`
        : connectorToTarget.type === "coworker_inferred"
          ? "Likely coworker (inferred)"
          : "Knows";
  lines.push(`${connector.name} \u2192 ${target.name}: ${label}`);

  const interactions = connectorToTarget.evidence.filter((e) => e.kind !== "shared_employer");
  if (interactions.length) {
    const byKind = new Map<string, number>();
    for (const e of interactions) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
    lines.push(
      [...byKind.entries()].map(([kind, n]) => `${n} ${kind}${n > 1 ? "s" : ""}`).join(", "),
    );
  }
  const shared = connectorToTarget.evidence.find((e) => e.kind === "shared_employer");
  if (shared?.rawRef) lines.push(`Worked together: ${shared.rawRef}`);

  if (teamToConnector) {
    const via = graph.getPerson(teamToConnector.fromPersonId);
    if (via) lines.push(`Reachable via ${via.name}'s network`);
  }
  return lines;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Rank intro-makers for a target. Considers direct paths (a teammate knows the
 * target) and one-hop paths (a teammate knows a connector who knows the target).
 */
export function rankIntroPaths(
  graph: IntroGraph,
  targetId: string,
  ctx: ScoringContext,
): IntroPath[] {
  const target = graph.getPerson(targetId);
  if (!target) return [];
  const weights = ctx.weights ?? DEFAULT_WEIGHTS;
  const signalWeights = ctx.signalWeights ?? DEFAULT_SIGNAL_WEIGHTS;
  const ttlDays = ctx.freshnessTtlDays ?? 90;
  const now = ctx.now ?? new Date();
  const minScore = ctx.minScore ?? 25;

  // All edges pointing at the target identify candidate connectors.
  const incoming = graph.allEdges().filter((e) => e.toPersonId === targetId);
  const paths: IntroPath[] = [];

  for (const connectorToTarget of incoming) {
    const connectorId = connectorToTarget.fromPersonId;
    const connector = graph.getPerson(connectorId);
    if (!connector) continue;

    const connectorIsTeam = ctx.teamMemberIds.has(connectorId);
    // Find the strongest team->connector edge if the connector isn't a teammate.
    let teamToConnector: Edge | undefined;
    if (!connectorIsTeam) {
      const candidates = graph
        .allEdges()
        .filter((e) => e.toPersonId === connectorId && ctx.teamMemberIds.has(e.fromPersonId));
      teamToConnector = candidates.sort((a, b) => b.confidence - a.confidence)[0];
      // No route from the team to this connector -> not actionable.
      if (!teamToConnector) continue;
    }
    const viaTeamMemberId = connectorIsTeam ? connectorId : teamToConnector!.fromPersonId;

    const closenessToTarget = scoreClosenessToTarget(connectorToTarget, signalWeights, ttlDays, now);
    const credibility = scoreCredibility(
      connector,
      target,
      ctx.credibilityRatingById?.get(connectorId),
    );
    const closenessToYou = scoreClosenessToYou(connectorId, ctx, teamToConnector, ttlDays, now);
    const responsiveness = ctx.responsivenessById?.get(connectorId) ?? 0.5;
    const riskConsent = scoreRiskConsent(connectorId, ctx, connectorToTarget, ttlDays, now);

    const composite =
      (closenessToTarget * weights.closenessToTarget +
        credibility * weights.credibility +
        closenessToYou * weights.closenessToYou +
        responsiveness * weights.responsiveness +
        riskConsent * weights.riskConsent) *
      100;

    const veracity = edgeVeracity(connectorToTarget);
    // A purely inferred path must clear a higher bar than a confirmed one.
    const bar = veracity === "likely" ? Math.max(minScore, 40) : minScore;
    if (composite < bar) continue;

    paths.push({
      targetId,
      connectorId,
      viaTeamMemberId,
      connectorToTarget,
      teamToConnector,
      veracity,
      breakdown: {
        closenessToTarget: round(closenessToTarget),
        credibility: round(credibility),
        closenessToYou: round(closenessToYou),
        responsiveness: round(responsiveness),
        riskConsent: round(riskConsent),
        composite: Math.round(composite),
      },
      evidenceSummary: summarize(connector, target, connectorToTarget, teamToConnector, graph),
    });
  }

  return paths.sort((a, b) => b.breakdown.composite - a.breakdown.composite);
}
