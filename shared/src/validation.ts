import type { DraftSet, ProfileData } from "./types";
import { NAME_SHORTENINGS } from "./defaults";

export const MESSAGE_WORD_MIN = 50;
export const MESSAGE_WORD_MAX = 70;

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

export function buildAllowedFacts(profile: ProfileData, notes: string, allowWhopProof = true): AllowedFacts {
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

  return {
    names: [...names],
    companies: [...companies],
    schools: [...schools],
    titles: [...titles],
    headlinePhrases,
    notePhrases,
    whopProofAllowed: allowWhopProof,
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

const SUSPICIOUS_CLAIM_PATTERNS = [
  /\b(mutual|we met|referred by|your friend)\b/i,
  /\b(i saw you at|met you at|ran into you)\b/i,
  /\b(congrats on (the )?(raise|funding|acquisition))\b/i,
  /\b(your (recent )?post about)\b/i,
];

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
    if (!known && mentioned.length > 3) {
      issues.push(`May reference unverified company: "${m[1].trim()}"`);
    }
  }
  return issues;
}

export function validateDraftSet(
  drafts: DraftSet,
  profile: ProfileData,
  notes: string,
  opts?: { personaIsFounder?: boolean; founderVariant?: string },
): DraftValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const allowed = buildAllowedFacts(profile, notes, opts?.founderVariant === "founder_direct");

  for (const [key, text] of Object.entries(drafts) as [string, string][]) {
    if (!text?.trim()) {
      errors.push(`${key} is empty`);
      continue;
    }

    for (const pat of SUSPICIOUS_CLAIM_PATTERNS) {
      if (pat.test(text)) {
        warnings.push(`${key}: possible invented social context — review before sending`);
        break;
      }
    }

    const words = countWords(text);
    if (words < MESSAGE_WORD_MIN || words > MESSAGE_WORD_MAX) {
      warnings.push(
        `${key}: ${words} words — outside the ${MESSAGE_WORD_MIN}-${MESSAGE_WORD_MAX} word range; trim or expand before sending`,
      );
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
  const followUp1 = typeof obj.followUp1 === "string" ? obj.followUp1.trim() : "";
  const followUp2 = typeof obj.followUp2 === "string" ? obj.followUp2.trim() : "";

  if (!initial) throw new Error("Model returned empty initial draft");

  return { initial, followUp1, followUp2 };
}

export function sanitizeSentText(text: string): string {
  return text.trim().slice(0, 8000);
}
