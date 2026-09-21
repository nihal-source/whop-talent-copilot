import type { ContextFact, DraftSet, OutreachPersona, PersonalStructure, ProfileData } from "./types";
import { DEFAULT_PERSONAL_STRUCTURE, NAME_SHORTENINGS, otherPersonalStructure } from "./defaults";

/** Default range, still used by the Founder persona and by follow-up length guidance. */
export const MESSAGE_WORD_MIN = 50;
export const MESSAGE_WORD_MAX = 70;

export interface WordRange {
  min: number;
  max: number;
}

/**
 * Shape 1 lands naturally shorter than Shape 2 — padding an observation-plus-question
 * message out to 50 words is exactly what used to turn it into a pitch, so each shape
 * gets the range it reads well at instead of one shared range.
 */
export const PERSONAL_SHAPE_WORD_RANGES: Record<PersonalStructure, WordRange> = {
  personal_obs_only: { min: 18, max: 45 },
  personal_obs_value: { min: 30, max: 60 },
};

export const PERSONAL_FOLLOW_UP_WORD_RANGE: WordRange = { min: 25, max: 55 };
export const FOUNDER_WORD_RANGE: WordRange = { min: MESSAGE_WORD_MIN, max: MESSAGE_WORD_MAX };

export type DraftKey = "initial" | "initialAlt" | "followUp1" | "followUp2";

export function wordRangeFor(
  key: DraftKey,
  opts: { persona?: OutreachPersona; personalStructure?: PersonalStructure } = {},
): WordRange {
  if (opts.persona === "founder") return FOUNDER_WORD_RANGE;
  const structure = opts.personalStructure ?? DEFAULT_PERSONAL_STRUCTURE;
  if (key === "initial") return PERSONAL_SHAPE_WORD_RANGES[structure];
  if (key === "initialAlt") return PERSONAL_SHAPE_WORD_RANGES[otherPersonalStructure(structure)];
  return PERSONAL_FOLLOW_UP_WORD_RANGE;
}

export function formatWordRange(range: WordRange): string {
  return `${range.min}-${range.max}`;
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Facts the model is allowed to reference — derived only from scrape + user notes. */
export interface AllowedFacts {
  names: string[];
  companies: string[];
  schools: string[];
  titles: string[];
  headlinePhrases: string[];
  notePhrases: string[];
  whopProofAllowed: boolean;
  /** Lowercased concatenation of enabled external context — grounds news/funding/company claims. */
  contextCorpus: string;
  /** Everything we actually know, lowercased — grounds claims like quota, #1, or a raise. */
  groundingCorpus: string;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
}

export function shortNameFromFirst(firstName: string): string {
  const lower = firstName.toLowerCase();
  const short = NAME_SHORTENINGS[lower] ?? firstName;
  return short.charAt(0).toUpperCase() + short.slice(1).toLowerCase();
}

export function mergeProfileWithOverrides(
  scraped: ProfileData,
  manual: { name?: string; company?: string; title?: string; headline?: string },
): ProfileData {
  const name = (manual.name?.trim() || scraped.name).trim();
  const firstName = name.split(/\s+/)[0] || scraped.firstName;
  const shortName = shortNameFromFirst(firstName);

  return {
    ...scraped,
    name: name || "Unknown",
    firstName,
    shortName,
    currentCompany: manual.company?.trim() || scraped.currentCompany,
    currentTitle: manual.title?.trim() || scraped.currentTitle,
    headline: manual.headline?.trim() || scraped.headline,
    scrapeHealth:
      name !== "Unknown" && (scraped.experience.length > 0 || manual.company || manual.title)
        ? scraped.scrapeHealth === "failed"
          ? "partial"
          : scraped.scrapeHealth
        : scraped.scrapeHealth,
  };
}

export function isProfileReadyForGeneration(profile: ProfileData): { ok: boolean; reason?: string } {
  if (profile.name === "Unknown" || !profile.name.trim()) {
    return { ok: false, reason: "Name missing — fill manual override before generating." };
  }
  if (!profile.currentCompany && !profile.currentTitle && !profile.headline && profile.experience.length === 0) {
    return { ok: false, reason: "Not enough profile context — add company/title or notes before generating." };
  }
  return { ok: true };
}

export function buildAllowedFacts(
  profile: ProfileData,
  notes: string,
  allowWhopProof = true,
  context: ContextFact[] = [],
): AllowedFacts {
  const names = new Set<string>();
  if (profile.name) names.add(profile.name.toLowerCase());
  if (profile.firstName) names.add(profile.firstName.toLowerCase());
  if (profile.shortName) names.add(profile.shortName.toLowerCase());

  const companies = new Set<string>();
  if (profile.currentCompany) companies.add(profile.currentCompany.toLowerCase());
  for (const e of profile.experience) {
    if (e.company) companies.add(e.company.toLowerCase());
  }

  const schools = new Set<string>();
  for (const e of profile.education) {
    if (e.school) schools.add(e.school.toLowerCase());
  }

  const titles = new Set<string>();
  if (profile.currentTitle) titles.add(profile.currentTitle.toLowerCase());
  for (const e of profile.experience) {
    if (e.title) titles.add(e.title.toLowerCase());
  }

  const headlinePhrases = tokenize(profile.headline).filter((t) => t.length >= 4);

  const notePhrases = notes
    .split(/[,;\n]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length >= 3);

  const contextCorpus = context
    .filter((c) => c.enabled)
    .map((c) => c.text.toLowerCase())
    .join(" \n ");

  const groundingCorpus = [
    profile.headline,
    profile.about,
    notes,
    [...titles].join(" "),
    [...companies].join(" "),
    [...schools].join(" "),
    contextCorpus,
  ]
    .join(" \n ")
    .toLowerCase();

  return {
    names: [...names],
    companies: [...companies],
    schools: [...schools],
    titles: [...titles],
    headlinePhrases,
    notePhrases,
    whopProofAllowed: allowWhopProof,
    contextCorpus,
    groundingCorpus,
  };
}

/** Company names that commonly cause false-positive substring matches. */
const COMPANY_MATCH_BLOCKLIST = new Set(["icon", "meta", "ai", "labs"]);

export function matchesCompanyStrict(company: string, list: string[]): boolean {
  const c = company.toLowerCase().trim();
  if (!c) return false;
  return list.some((name) => {
    const n = name.toLowerCase().replace(/^ex-/, "").trim();
    if (!n || n.length < 3) return false;
    if (COMPANY_MATCH_BLOCKLIST.has(n) && c !== n) return false;
    // Whole-word or full-string match to reduce false positives
    const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|\\b)${escaped}(\\b|$)`, "i");
    return re.test(c) || c === n;
  });
}

// Always suspicious — these claim a personal/social relationship that no data source can verify.
const ALWAYS_SUSPICIOUS_PATTERNS = [
  /\b(mutual|we met|referred by|your friend)\b/i,
  /\b(i saw you at|met you at|ran into you)\b/i,
];

// Suspicious only if NOT substantiated by verified external context (news/funding/posts).
const CONTEXT_DEPENDENT_PATTERNS = [
  /\b(congrats on (the )?(raise|funding|acquisition|launch|round))\b/i,
  /\b(your (recent )?post about)\b/i,
  /\b(saw (the )?news|read that|just launched|recently raised)\b/i,
];

// Achievements a scrape can never establish on its own. Allowed only when the same
// claim shows up in the profile, the notes, or verified context.
const UNVERIFIED_CREDENTIAL_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /(?:\bnumber one\b|#\s?1\b|\btop (?:rep|performer|seller)\b)/i, label: "a #1 / top-performer ranking" },
  { pattern: /\b(?:quota|president'?s club)\b/i, label: "quota attainment or President's Club" },
  { pattern: /\b\d+x(?:'?d)?\b/i, label: "a growth multiple" },
  { pattern: /\b(?:series [a-e]\b|seed round|raised \$)/i, label: "a funding round" },
];

// Whop selling, in any form. Shape 1 is an observation and a question — none of this belongs.
const WHOP_PITCH_PATTERNS = [
  /\b(?:ex-?founders|unicorn(?:'?d)?|1\.6b|300m|mercor|ote|base salary)\b/i,
  /\b(?:a ton of )?equity\b/i,
  /\b(?:we(?:'re| are)|we)\s+(?:hiring|scaling|building out)\b/i,
  /\b(?:hiring for|come build|join (?:us|the team|whop))\b/i,
  /\bceiling\b/i,
];

// Shape 1 closes on curiosity about them, not on booking time.
const CALL_ASK_PATTERNS = [/\bworth a (?:quick )?(?:chat|convo|call)\b/i, /\b(?:down to chat|15 ?min|hop on a call|grab time)\b/i];

export interface DraftValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

function mentionsUnknownCompany(text: string, allowed: AllowedFacts): string[] {
  const issues: string[] = [];
  // Heuristic: "at X" or "@ X" where X isn't in allowed companies
  const atMatches = text.matchAll(/\b(?:at|@)\s+([A-Z][A-Za-z0-9&.\- ]{2,30})/g);
  for (const m of atMatches) {
    const mentioned = m[1].trim().toLowerCase();
    if (mentioned === "whop") continue;
    const known = allowed.companies.some(
      (c) => c.includes(mentioned) || mentioned.includes(c.split(/\s+/)[0] ?? ""),
    );
    // A company named in verified external context is legitimate to reference.
    const inContext = allowed.contextCorpus.includes(mentioned);
    if (!known && !inContext && mentioned.length > 3) {
      issues.push(`May reference unverified company: "${m[1].trim()}"`);
    }
  }
  return issues;
}

export function validateDraftSet(
  drafts: DraftSet,
  profile: ProfileData,
  notes: string,
  opts?: {
    personaIsFounder?: boolean;
    founderVariant?: string;
    /** Shape of `drafts.initial`; `drafts.initialAlt` is validated as the other shape. */
    personalStructure?: PersonalStructure;
    context?: ContextFact[];
  },
): DraftValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const context = opts?.context ?? [];
  const allowed = buildAllowedFacts(profile, notes, opts?.founderVariant === "founder_direct", context);
  const hasEnabledContext = context.some((c) => c.enabled && c.text.trim());
  const persona: OutreachPersona = opts?.personaIsFounder ? "founder" : "personal";
  const structure = opts?.personalStructure ?? DEFAULT_PERSONAL_STRUCTURE;

  for (const [key, text] of Object.entries(drafts) as [DraftKey, string | undefined][]) {
    // initialAlt is optional — an absent alternate is not a missing draft.
    if (text === undefined && key === "initialAlt") continue;
    if (!text?.trim()) {
      errors.push(`${key} is empty`);
      continue;
    }

    for (const pat of ALWAYS_SUSPICIOUS_PATTERNS) {
      if (pat.test(text)) {
        warnings.push(`${key}: claims a personal/social connection that can't be verified — review before sending`);
        break;
      }
    }

    // News/funding/post references are only OK when grounded in verified external context.
    if (!hasEnabledContext) {
      for (const pat of CONTEXT_DEPENDENT_PATTERNS) {
        if (pat.test(text)) {
          warnings.push(`${key}: references news/funding/a post but no verified context was provided — confirm it's real before sending`);
          break;
        }
      }
    }

    for (const { pattern, label } of UNVERIFIED_CREDENTIAL_PATTERNS) {
      if (pattern.test(text) && !pattern.test(allowed.groundingCorpus)) {
        warnings.push(`${key}: claims ${label} that isn't in the profile, notes, or verified context — ask about it instead`);
      }
    }

    const range = wordRangeFor(key, { persona, personalStructure: structure });
    const words = countWords(text);
    if (words < range.min || words > range.max) {
      warnings.push(
        `${key}: ${words} words — outside the ${formatWordRange(range)} word range for this shape; trim or expand before sending`,
      );
    }

    // Shape 1 is an observation and a question. Anything that sells is the wrong shape.
    const isInitial = key === "initial" || key === "initialAlt";
    const shapeForKey = key === "initialAlt" ? otherPersonalStructure(structure) : structure;
    if (!opts?.personaIsFounder && isInitial && shapeForKey === "personal_obs_only") {
      if (WHOP_PITCH_PATTERNS.some((p) => p.test(text))) {
        warnings.push(`${key}: Shape 1 should be observation + question only — drop the Whop pitch or switch it to Shape 2`);
      }
      if (CALL_ASK_PATTERNS.some((p) => p.test(text))) {
        warnings.push(`${key}: Shape 1 should end on a question about them, not an ask for a call`);
      }
    }

    warnings.push(...mentionsUnknownCompany(text, allowed));

    // Founder non-direct should not pitch Whop heavily
    if (opts?.personaIsFounder && opts.founderVariant !== "founder_direct") {
      if (/\b(1\.6b|unicorn|300m|mercor|175k|500k OTE|370k)\b/i.test(text)) {
        warnings.push(`${key}: founder variant should not include Whop comp/stats unless direct variant`);
      }
    }
  }

  return { valid: errors.length === 0, warnings: [...new Set(warnings)], errors };
}

export function parseDraftJson(text: string): DraftSet {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in model response");
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error("Invalid JSON in model response");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Draft response was not an object");

  const obj = parsed as Record<string, unknown>;
  const initial = typeof obj.initial === "string" ? obj.initial.trim() : "";
  const initialAlt = typeof obj.initialAlt === "string" ? obj.initialAlt.trim() : "";
  const followUp1 = typeof obj.followUp1 === "string" ? obj.followUp1.trim() : "";
  const followUp2 = typeof obj.followUp2 === "string" ? obj.followUp2.trim() : "";

  if (!initial) throw new Error("Model returned empty initial draft");

  return initialAlt ? { initial, initialAlt, followUp1, followUp2 } : { initial, followUp1, followUp2 };
}

export function sanitizeSentText(text: string): string {
  return text.trim().slice(0, 8000);
}
