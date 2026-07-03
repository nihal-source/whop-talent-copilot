import type { IntroGraph } from "./builder";
import type { IntroPath } from "./scorer";
import type { Edge, Person } from "./types";

/**
 * Grounding + validation for intro-request drafts. An intro ask may only state
 * relationship claims that are backed by an edge actually present in the graph.
 * This mirrors the outreach copilot's allowed-facts guard (shared/src/validation)
 * but for connection claims rather than profile facts.
 */

export interface IntroFacts {
  connectorName: string;
  targetName: string;
  /** Human-readable, verified relationship statements the draft may reference. */
  verifiedRelationship: string[];
  /** Second-person phrasing for the ask, e.g. "are connected to them on LinkedIn". */
  relationshipSecondPerson: string;
  /** Lowercased tokens permitted in claims (names, companies, platforms). */
  allowedTokens: Set<string>;
  /** True only when the connector->target edge is confirmed (not inferred). */
  relationshipConfirmed: boolean;
}

/** Third-person phrase for display: "<Connector> <phrase>". */
function relationshipPhrase(edge: Edge): string {
  switch (edge.type) {
    case "connection":
      return "is connected to them on LinkedIn";
    case "follows":
      return "follows them";
    case "followed_by":
      return "is followed by them";
    case "coworker_inferred":
      return "likely worked with them";
    default:
      return "knows them";
  }
}

/** Second-person phrase for the ask: "you <phrase>". */
function relationshipPhraseSecondPerson(edge: Edge): string {
  switch (edge.type) {
    case "connection":
      return "are connected to them on LinkedIn";
    case "follows":
      return "follow them";
    case "followed_by":
      return "are followed by them";
    case "coworker_inferred":
      return "may have worked with them";
    default:
      return "may know them";
  }
}

export function buildIntroFacts(graph: IntroGraph, path: IntroPath): IntroFacts {
  const connector = graph.getPerson(path.connectorId);
  const target = graph.getPerson(path.targetId);
  const connectorName = connector?.name ?? "your contact";
  const targetName = target?.name ?? "the target";

  const verified: string[] = [`${connectorName} ${relationshipPhrase(path.connectorToTarget)}`];
  const interactions = path.connectorToTarget.evidence.filter((e) => e.kind !== "shared_employer");
  if (interactions.length) {
    verified.push(`${connectorName} has interacted with them (${interactions.length} recorded)`);
  }

  const allowedTokens = new Set<string>();
  for (const p of [connector, target]) addPersonTokens(allowedTokens, p);

  return {
    connectorName,
    targetName,
    verifiedRelationship: verified,
    relationshipSecondPerson: relationshipPhraseSecondPerson(path.connectorToTarget),
    allowedTokens,
    relationshipConfirmed: path.veracity === "confirmed",
  };
}

function addPersonTokens(set: Set<string>, person?: Person): void {
  if (!person) return;
  for (const token of person.name.toLowerCase().split(/\s+/)) {
    if (token.length >= 2) set.add(token);
  }
  if (person.company) set.add(person.company.toLowerCase());
  if (person.title) {
    for (const token of person.title.toLowerCase().split(/\s+/)) {
      if (token.length >= 3) set.add(token);
    }
  }
}

export interface IntroDraftValidation {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

// Claims that assert a closeness the graph cannot prove.
const OVERCLAIM_PATTERNS = [
  /\b(close friends?|best friends?|good friends?)\b/i,
  /\b(we all know|everyone knows|definitely knows)\b/i,
];

// Inferred (coworker) relationships must not be stated as certain.
const CERTAINTY_PATTERNS = [/\b(knows them well|is close with|good relationship with)\b/i];

/**
 * Validate an intro-request draft against the verified facts. Errors block; the
 * connector name and target name must appear, and inferred relationships may not
 * be phrased with certainty.
 */
export function validateIntroDraft(draft: string, facts: IntroFacts): IntroDraftValidation {
  const warnings: string[] = [];
  const errors: string[] = [];
  const text = draft.trim();
  if (!text) {
    errors.push("Draft is empty");
    return { valid: false, warnings, errors };
  }

  const lower = text.toLowerCase();
  if (!lower.includes(facts.targetName.split(/\s+/)[0].toLowerCase())) {
    warnings.push("Draft does not mention the target by name");
  }

  for (const pat of OVERCLAIM_PATTERNS) {
    if (pat.test(text)) {
      errors.push("Draft claims a closeness the data cannot verify — remove it before sending");
      break;
    }
  }

  if (!facts.relationshipConfirmed) {
    for (const pat of CERTAINTY_PATTERNS) {
      if (pat.test(text)) {
        warnings.push(
          "This path is inferred (likely coworker), not confirmed — soften certainty language",
        );
        break;
      }
    }
    if (/\bmutual\b/i.test(text)) {
      errors.push("Cannot claim a mutual connection on an inferred (unconfirmed) path");
    }
  }

  return { valid: errors.length === 0, warnings, errors };
}

/**
 * Deterministic fallback intro-ask draft grounded strictly in verified facts.
 * The web app / extension can pass this to an LLM as a seed, but the validator
 * above is the source of truth for what is allowed.
 */
export function draftIntroRequest(facts: IntroFacts, purpose: string): string {
  const hedge = facts.relationshipConfirmed ? "" : " if you two are actually in touch";
  return [
    `Hey ${facts.connectorName.split(/\s+/)[0]} — I saw you ${facts.relationshipSecondPerson}.`,
    `I'm trying to reach ${facts.targetName} about ${purpose.trim() || "a quick conversation"}.`,
    `Would you be open to a warm intro${hedge}? Happy to send a forwardable blurb.`,
  ].join(" ");
}
