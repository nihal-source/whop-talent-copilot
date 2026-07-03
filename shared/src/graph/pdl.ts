import type { Person } from "./types";
import { MAX_INFERRED_CONFIDENCE } from "./types";
import { makeAccount, normalizeName } from "./identity";

/**
 * People Data Labs integration. PDL is used ONLY for identity resolution and
 * coworker-overlap inference — never for connection lists or interaction history
 * (PDL does not provide those). Enriched coworker edges are always "likely",
 * never "confirmed".
 */

export interface PdlExperience {
  company?: { name?: string };
  title?: { name?: string };
  start_date?: string;
  end_date?: string;
}

export interface PdlProfile {
  handle?: string;
  network?: string; // "linkedin", "twitter", etc.
  url?: string;
}

export interface PdlPersonRecord {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  job_title?: string;
  job_company_name?: string;
  location_name?: string;
  linkedin_url?: string;
  twitter_url?: string;
  profiles?: PdlProfile[];
  experience?: PdlExperience[];
  /** PDL match likelihood, 0-1, present on enrich/identify responses. */
  likelihood?: number;
}

export interface PdlEnrichResponse {
  status: number;
  likelihood?: number;
  data?: PdlPersonRecord;
}

export interface PdlIdentifyResponse {
  status: number;
  matches?: Array<{ match_score?: number; data: PdlPersonRecord }>;
}

const PDL_BASE = "https://api.peopledatalabs.com/v5";

function socialUrlFor(network: string, profiles: PdlProfile[] = []): string | undefined {
  const p = profiles.find((x) => (x.network ?? "").toLowerCase() === network);
  return p?.url;
}

/** Map a PDL person record into a graph Person node. */
export function pdlRecordToPerson(
  id: string,
  rec: PdlPersonRecord,
  matchScore: number,
): Person {
  const name = rec.full_name || [rec.first_name, rec.last_name].filter(Boolean).join(" ") || "Unknown";
  const accounts = [];
  const li = rec.linkedin_url || socialUrlFor("linkedin", rec.profiles);
  if (li) accounts.push(makeAccount("linkedin", li));
  const x = rec.twitter_url || socialUrlFor("twitter", rec.profiles);
  if (x) accounts.push(makeAccount("x", x));
  const ig = socialUrlFor("instagram", rec.profiles);
  if (ig) accounts.push(makeAccount("instagram", ig));

  return {
    id,
    name,
    normalizedName: normalizeName(name),
    accounts,
    company: rec.job_company_name,
    title: rec.job_title,
    location: rec.location_name,
    resolution: "pdl",
    resolutionConfidence: clamp01(matchScore),
  };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export interface PdlEnrichParams {
  name?: string;
  company?: string;
  linkedinUrl?: string;
  email?: string;
}

/**
 * 1:1 enrichment — resolves a single target. Returns null when PDL has no match
 * or the match is below the min likelihood (avoids acting on a wrong identity).
 */
export async function pdlEnrichPerson(
  apiKey: string,
  params: PdlEnrichParams,
  opts: { minLikelihood?: number } = {},
): Promise<{ record: PdlPersonRecord; likelihood: number } | null> {
  if (!apiKey.trim()) throw new Error("People Data Labs API key required");
  const query = new URLSearchParams();
  if (params.linkedinUrl) query.set("profile", params.linkedinUrl);
  if (params.email) query.set("email", params.email);
  if (params.name) query.set("name", params.name);
  if (params.company) query.set("company", params.company);
  query.set("min_likelihood", String(opts.minLikelihood ?? 6));

  const res = await fetch(`${PDL_BASE}/person/enrich?${query.toString()}`, {
    headers: { "X-Api-Key": apiKey },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`PDL enrich error: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as PdlEnrichResponse;
  if (!body.data) return null;
  return { record: body.data, likelihood: clamp01((body.likelihood ?? 0) / 10) };
}

/** 1:many disambiguation — returns candidate matches for the UI to pick from. */
export async function pdlIdentifyPerson(
  apiKey: string,
  params: PdlEnrichParams,
): Promise<Array<{ record: PdlPersonRecord; matchScore: number }>> {
  if (!apiKey.trim()) throw new Error("People Data Labs API key required");
  const query = new URLSearchParams();
  if (params.name) query.set("name", params.name);
  if (params.company) query.set("company", params.company);
  if (params.linkedinUrl) query.set("profile", params.linkedinUrl);

  const res = await fetch(`${PDL_BASE}/person/identify?${query.toString()}`, {
    headers: { "X-Api-Key": apiKey },
  });
  if (res.status === 404) return [];
  if (!res.ok) {
    throw new Error(`PDL identify error: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as PdlIdentifyResponse;
  return (body.matches ?? []).map((m) => ({
    record: m.data,
    matchScore: clamp01((m.match_score ?? 0) / 10),
  }));
}

export interface CoworkerOverlap {
  company: string;
  startYear?: number;
  endYear?: number;
  /** Years of overlap; drives the inferred-edge confidence. */
  overlapYears: number;
}

function yearOf(date?: string): number | undefined {
  if (!date) return undefined;
  const m = date.match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : undefined;
}

/**
 * Compute overlapping employment between two PDL records. This is the only
 * signal PDL gives us for "these people plausibly know each other". The result
 * feeds a coworker_inferred edge whose confidence is capped low.
 */
export function coworkerOverlaps(
  a: PdlPersonRecord,
  b: PdlPersonRecord,
): CoworkerOverlap[] {
  const overlaps: CoworkerOverlap[] = [];
  const CURRENT = new Date().getFullYear();
  for (const ea of a.experience ?? []) {
    const companyA = ea.company?.name?.toLowerCase().trim();
    if (!companyA) continue;
    for (const eb of b.experience ?? []) {
      const companyB = eb.company?.name?.toLowerCase().trim();
      if (!companyB || companyA !== companyB) continue;
      const aStart = yearOf(ea.start_date) ?? 0;
      const aEnd = yearOf(ea.end_date) ?? CURRENT;
      const bStart = yearOf(eb.start_date) ?? 0;
      const bEnd = yearOf(eb.end_date) ?? CURRENT;
      const start = Math.max(aStart, bStart);
      const end = Math.min(aEnd, bEnd);
      if (end >= start && start > 0) {
        overlaps.push({
          company: ea.company?.name ?? companyA,
          startYear: start,
          endYear: end,
          overlapYears: end - start + 1,
        });
      }
    }
  }
  return overlaps;
}

/**
 * Confidence for an inferred coworker edge. More overlap years and smaller
 * companies imply a stronger tie, but it is always capped below confirmed edges.
 */
export function inferredConfidence(overlap: CoworkerOverlap): number {
  const base = 0.2 + Math.min(overlap.overlapYears, 4) * 0.05;
  return Math.min(base, MAX_INFERRED_CONFIDENCE);
}
