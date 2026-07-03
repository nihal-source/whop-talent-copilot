import { pdlEnrichPerson, type PdlPersonRecord } from "./graph/pdl";
import type { EducationEntry, ExperienceEntry, ProfileData } from "./types";
import { shortNameFromFirst } from "./validation";

/**
 * Pluggable profile-data providers. "dom" scrapes the open LinkedIn tab (free, live).
 * "apify" calls a real-time, no-cookie LinkedIn enricher (URL -> structured JSON).
 * "pdl" resolves identity via People Data Labs (consent-based; used for warm-intro
 * target lookup). Add more providers by implementing a normalizer + fetch.
 */
export type EnrichmentProvider = "none" | "apify" | "pdl";

function yearFrom(dateStr?: string | null): number | undefined {
  if (!dateStr) return undefined;
  const m = String(dateStr).match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : undefined;
}

interface ApifyRaw {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  headline?: string;
  summary?: string;
  status?: string;
  location?: string | { default?: string; short?: string };
  links?: { linkedin?: string };
  company?: { name?: string };
  educations?: Array<{
    school?: { name?: string };
    degree_name?: string;
    field_of_study?: string;
    date?: { start?: string | null; end?: string | null };
  }>;
  position_groups?: Array<{
    company?: { name?: string };
    date?: { start?: string | null; end?: string | null };
    profile_positions?: Array<{
      company?: string;
      title?: string;
      date?: { start?: string | null; end?: string | null };
    }>;
  }>;
}

export function normalizeApifyProfile(raw: ApifyRaw, fallbackUrl: string): ProfileData {
  const fullName =
    raw.full_name || [raw.first_name, raw.last_name].filter(Boolean).join(" ") || "Unknown";
  const firstName = raw.first_name || fullName.split(/\s+/)[0] || fullName;

  const experience: ExperienceEntry[] = [];
  for (const g of raw.position_groups ?? []) {
    const positions = g.profile_positions ?? [];
    if (positions.length) {
      for (const p of positions) {
        experience.push({
          company: p.company || g.company?.name || "",
          title: p.title || "",
          startDate: p.date?.start ?? g.date?.start ?? undefined,
          endDate: p.date?.end ?? undefined,
          isCurrent: !(p.date?.end ?? g.date?.end),
        });
      }
    } else {
      experience.push({
        company: g.company?.name || "",
        title: "",
        startDate: g.date?.start ?? undefined,
        endDate: g.date?.end ?? undefined,
        isCurrent: !g.date?.end,
      });
    }
  }

  const education: EducationEntry[] = (raw.educations ?? [])
    .map((e) => ({
      school: e.school?.name || "",
      degree: e.degree_name || e.field_of_study || undefined,
      startYear: yearFrom(e.date?.start),
      endYear: yearFrom(e.date?.end),
    }))
    .filter((e) => e.school);

  const current = experience.find((e) => e.isCurrent) ?? experience[0];
  const location =
    typeof raw.location === "string"
      ? raw.location
      : raw.location?.default || raw.location?.short || "";

  return {
    linkedinUrl: raw.links?.linkedin || fallbackUrl,
    name: fullName,
    firstName,
    shortName: shortNameFromFirst(firstName),
    headline: raw.headline || "",
    currentCompany: raw.company?.name || current?.company || "",
    currentTitle: raw.title || current?.title || "",
    location,
    about: raw.summary || "",
    education,
    experience,
    scrapeHealth: fullName !== "Unknown" ? (experience.length ? "full" : "partial") : "failed",
  };
}

export async function enrichViaApify(apiToken: string, profileUrl: string): Promise<ProfileData> {
  if (!apiToken.trim()) throw new Error("Apify API token required (set it in Options)");
  const endpoint = `https://api.apify.com/v2/acts/atomus~linkedin-profile-enricher/run-sync-get-dataset-items?token=${encodeURIComponent(
    apiToken,
  )}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profileUrls: [profileUrl] }),
  });
  if (!res.ok) {
    throw new Error(`Enrichment API error: ${res.status} ${await res.text()}`);
  }
  const items = (await res.json()) as ApifyRaw[] | ApifyRaw;
  const raw = Array.isArray(items) ? items[0] : items;
  if (!raw || raw.status === "not_found") {
    throw new Error("Profile not found by enrichment API");
  }
  return normalizeApifyProfile(raw, profileUrl);
}

/** Map a People Data Labs person record into the ProfileData shape. */
export function normalizePdlProfile(rec: PdlPersonRecord, fallbackUrl: string): ProfileData {
  const fullName =
    rec.full_name || [rec.first_name, rec.last_name].filter(Boolean).join(" ") || "Unknown";
  const firstName = rec.first_name || fullName.split(/\s+/)[0] || fullName;

  const experience: ExperienceEntry[] = (rec.experience ?? []).map((e) => ({
    company: e.company?.name || "",
    title: e.title?.name || "",
    startDate: e.start_date ?? undefined,
    endDate: e.end_date ?? undefined,
    isCurrent: !e.end_date,
  }));

  return {
    linkedinUrl: rec.linkedin_url || fallbackUrl,
    name: fullName,
    firstName,
    shortName: shortNameFromFirst(firstName),
    headline: rec.job_title || "",
    currentCompany: rec.job_company_name || experience.find((e) => e.isCurrent)?.company || "",
    currentTitle: rec.job_title || experience.find((e) => e.isCurrent)?.title || "",
    location: rec.location_name || "",
    about: "",
    education: [],
    experience,
    scrapeHealth: fullName !== "Unknown" ? (experience.length ? "full" : "partial") : "failed",
  };
}

export async function enrichViaPdl(apiKey: string, profileUrl: string): Promise<ProfileData> {
  const isUrl = /linkedin\.com\/in\//i.test(profileUrl);
  const match = await pdlEnrichPerson(apiKey, isUrl ? { linkedinUrl: profileUrl } : { name: profileUrl });
  if (!match) throw new Error("People Data Labs found no confident match");
  return normalizePdlProfile(match.record, profileUrl);
}

export async function enrichProfile(
  provider: EnrichmentProvider,
  apiToken: string,
  profileUrl: string,
): Promise<ProfileData> {
  switch (provider) {
    case "apify":
      return enrichViaApify(apiToken, profileUrl);
    case "pdl":
      return enrichViaPdl(apiToken, profileUrl);
    default:
      throw new Error("No enrichment provider configured");
  }
}
