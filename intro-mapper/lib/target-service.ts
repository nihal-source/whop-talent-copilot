import {
  makeAccount,
  mergeAccounts,
  normalizeName,
  pdlEnrichPerson,
  pdlIdentifyPerson,
  pdlRecordToPerson,
  type Person,
} from "./shared";
import { getStore } from "./store";
import type { Session } from "./auth";

export interface TargetQuery {
  name?: string;
  company?: string;
  linkedinUrl?: string;
}

export interface ResolvedTarget {
  person: Person;
  /** 0-1 confidence in the identity match (1 for manual entry the user typed). */
  matchConfidence: number;
  source: "pdl" | "manual";
  /** Alternative PDL matches for disambiguation when confidence is low. */
  alternatives?: Array<{ name: string; company?: string; linkedinUrl?: string; matchScore: number }>;
}

function targetId(orgId: string): string {
  return `person_target_${orgId}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Reuse an existing graph node when the resolved target already matches one by
 * platform handle. Without this, searching for someone who is already in a
 * teammate's network creates a duplicate node — which lets the target surface as
 * their own intro-maker. Merges new fields onto the existing node and returns it.
 */
async function dedupeTarget(orgId: string, candidate: Person): Promise<Person> {
  const store = await getStore();
  for (const account of candidate.accounts) {
    if (!account.handle) continue;
    const existing = await store.findPersonByHandle(orgId, account.platform, account.handle);
    if (!existing) continue;
    existing.accounts = mergeAccounts(existing.accounts, candidate.accounts);
    existing.company = existing.company || candidate.company;
    existing.title = existing.title || candidate.title;
    existing.location = existing.location || candidate.location;
    if (candidate.resolutionConfidence > existing.resolutionConfidence) {
      existing.resolution = candidate.resolution;
      existing.resolutionConfidence = candidate.resolutionConfidence;
    }
    await store.upsertPerson(orgId, existing);
    return existing;
  }
  await store.upsertPerson(orgId, candidate);
  return candidate;
}

/**
 * Resolve a target to a Person node. Prefers PDL enrichment for identity + social
 * URLs; falls back to a manually-entered node when no PDL key is set or no
 * confident match exists. Low-confidence matches return alternatives so the UI
 * can ask the user to disambiguate rather than guessing.
 */
export async function resolveTarget(
  session: Session,
  query: TargetQuery,
): Promise<ResolvedTarget> {
  const apiKey = process.env.PDL_API_KEY ?? "";

  if (apiKey.trim()) {
    const match = await pdlEnrichPerson(apiKey, {
      name: query.name,
      company: query.company,
      linkedinUrl: query.linkedinUrl,
    });
    if (match && match.likelihood >= 0.6) {
      const candidate = pdlRecordToPerson(targetId(session.org.id), match.record, match.likelihood);
      const person = await dedupeTarget(session.org.id, candidate);
      return { person, matchConfidence: match.likelihood, source: "pdl" };
    }
    // No confident single match — offer candidates.
    const candidates = await pdlIdentifyPerson(apiKey, query);
    if (candidates.length) {
      const best = candidates[0];
      const candidate = pdlRecordToPerson(targetId(session.org.id), best.record, best.matchScore);
      const person = await dedupeTarget(session.org.id, candidate);
      return {
        person,
        matchConfidence: best.matchScore,
        source: "pdl",
        alternatives: candidates.slice(0, 5).map((c) => ({
          name: c.record.full_name ?? "Unknown",
          company: c.record.job_company_name,
          linkedinUrl: c.record.linkedin_url,
          matchScore: c.matchScore,
        })),
      };
    }
  }

  // Manual fallback: build a node from what the user typed.
  const name = query.name?.trim() || query.linkedinUrl?.trim() || "Unknown target";
  const accounts = query.linkedinUrl ? [makeAccount("linkedin", query.linkedinUrl)] : [];
  const candidate: Person = {
    id: targetId(session.org.id),
    name,
    normalizedName: normalizeName(name),
    accounts,
    company: query.company?.trim() || undefined,
    resolution: "user_confirmed",
    resolutionConfidence: 1,
  };
  const person = await dedupeTarget(session.org.id, candidate);
  return { person, matchConfidence: 1, source: "manual" };
}
