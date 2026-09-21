import { pdlEnrichPerson, type PdlPersonRecord } from "./graph/pdl";
import type { AppSettings, EducationEntry, EnrichmentProvider, ExperienceEntry, ProfileData } from "./types";
import { shortNameFromFirst } from "./validation";

/**
 * Pluggable profile-data providers. "none" scrapes the open LinkedIn tab (free, live).
 * "apify" calls a real-time, no-cookie LinkedIn enricher (URL -> structured JSON).
 * "crustdata" calls Crustdata's person-enrich API (URL -> cached/real-time profile).
 * "pdl" resolves identity via People Data Labs (consent-based; used for warm-intro
 * target lookup). Add more providers by implementing a normalizer + fetch.
 */

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

/* ---------------------------------------------------------------- Crustdata */

const CRUSTDATA_BASE = "https://api.crustdata.com";

/** Sections Crustdata returns per person; only the ones a draft can use are requested. */
const CRUSTDATA_FIELDS = [
  "name",
  "location",
  "title",
  "headline",
  "summary",
  "linkedin_profile_url",
  "current_employers",
  "past_employers",
  "all_employers",
  "education_background",
].join(",");

interface CrustdataEmployment {
  employer_name?: string;
  company_name?: string;
  name?: string;
  employee_title?: string;
  title?: string;
  start_date?: string | null;
  end_date?: string | null;
}

interface CrustdataEducation {
  institute_name?: string;
  school?: string;
  degree_name?: string;
  degree?: string;
  field_of_study?: string;
  start_date?: string | null;
  end_date?: string | null;
}

export interface CrustdataPersonRaw {
  name?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  headline?: string;
  summary?: string;
  location?: string | { raw?: string; city?: string; state?: string; country?: string };
  region?: string;
  linkedin_profile_url?: string;
  linkedin_flagship_url?: string;
  flagship_profile_url?: string;
  current_employers?: CrustdataEmployment[];
  past_employers?: CrustdataEmployment[];
  all_employers?: CrustdataEmployment[];
  education_background?: CrustdataEducation[];
}

function employmentName(e: CrustdataEmployment): string {
  return e.employer_name || e.company_name || e.name || "";
}

function employmentTitle(e: CrustdataEmployment): string {
  return e.employee_title || e.title || "";
}

function crustdataLocation(raw: CrustdataPersonRaw): string {
  if (typeof raw.location === "string") return raw.location;
  const loc = raw.location;
  if (loc) {
    return loc.raw || [loc.city, loc.state, loc.country].filter(Boolean).join(", ");
  }
  return raw.region || "";
}

/**
 * Crustdata's newer `/person/enrich` returns nested sections instead of the flat
 * `/screener/person/enrich` record. Flatten it so one normalizer handles both.
 */
export function flattenCrustdataPersonData(personData: Record<string, unknown>): CrustdataPersonRaw {
  const basic = (personData.basic_profile ?? {}) as Record<string, unknown>;
  const experience = (personData.experience ?? {}) as Record<string, unknown>;
  const employment = (experience.employment_details ?? {}) as Record<string, unknown>;
  const education = (personData.education ?? {}) as Record<string, unknown>;

  return {
    name: basic.name as string | undefined,
    title: basic.current_title as string | undefined,
    headline: basic.headline as string | undefined,
    summary: basic.summary as string | undefined,
    location: basic.location as CrustdataPersonRaw["location"],
    current_employers: (employment.current ?? []) as CrustdataEmployment[],
    past_employers: (employment.past ?? []) as CrustdataEmployment[],
    education_background: (education.schools ?? []) as CrustdataEducation[],
  };
}

/** Pull the person record out of whichever response envelope Crustdata used. */
export function unwrapCrustdataResponse(body: unknown): CrustdataPersonRaw | null {
  const first = Array.isArray(body) ? body[0] : body;
  if (!first || typeof first !== "object") return null;
  const record = first as Record<string, unknown>;

  if (Array.isArray(record.matches)) {
    const match = record.matches[0] as Record<string, unknown> | undefined;
    const personData = match?.person_data as Record<string, unknown> | undefined;
    return personData ? flattenCrustdataPersonData(personData) : null;
  }
  if (record.person_data && typeof record.person_data === "object") {
    return flattenCrustdataPersonData(record.person_data as Record<string, unknown>);
  }
  for (const key of ["persons", "profiles", "data", "results"]) {
    const nested = record[key];
    if (Array.isArray(nested) && nested.length) return nested[0] as CrustdataPersonRaw;
  }
  return record as CrustdataPersonRaw;
}

export function normalizeCrustdataProfile(raw: CrustdataPersonRaw, fallbackUrl: string): ProfileData {
  const fullName =
    raw.name || [raw.first_name, raw.last_name].filter(Boolean).join(" ").trim() || "Unknown";
  const firstName = raw.first_name || fullName.split(/\s+/)[0] || fullName;

  const current = raw.current_employers ?? [];
  const past = raw.past_employers ?? [];
  const all = current.length || past.length ? [...current, ...past] : (raw.all_employers ?? []);

  const experience: ExperienceEntry[] = all
    .map((e) => ({
      company: employmentName(e),
      title: employmentTitle(e),
      startDate: e.start_date ?? undefined,
      endDate: e.end_date ?? undefined,
      isCurrent: current.includes(e) || !e.end_date,
    }))
    .filter((e) => e.company || e.title);

  const education: EducationEntry[] = (raw.education_background ?? [])
    .map((e) => ({
      school: e.institute_name || e.school || "",
      degree: e.degree_name || e.degree || e.field_of_study || undefined,
      startYear: yearFrom(e.start_date),
      endYear: yearFrom(e.end_date),
    }))
    .filter((e) => e.school);

  const currentRole = experience.find((e) => e.isCurrent) ?? experience[0];

  return {
    linkedinUrl: raw.linkedin_profile_url || raw.linkedin_flagship_url || raw.flagship_profile_url || fallbackUrl,
    name: fullName,
    firstName,
    shortName: shortNameFromFirst(firstName),
    headline: raw.headline || "",
    currentCompany: currentRole?.company || "",
    currentTitle: raw.title || currentRole?.title || "",
    location: crustdataLocation(raw),
    about: raw.summary || "",
    education,
    experience,
    scrapeHealth: fullName !== "Unknown" ? (experience.length ? "full" : "partial") : "failed",
  };
}

export async function enrichViaCrustdata(apiKey: string, profileUrl: string): Promise<ProfileData> {
  if (!apiKey.trim()) throw new Error("Crustdata API key required (set it in Options)");
  const query = new URLSearchParams({
    linkedin_profile_url: profileUrl,
    fields: CRUSTDATA_FIELDS,
    enrich_realtime: "false",
  });

  const res = await fetch(`${CRUSTDATA_BASE}/screener/person/enrich?${query.toString()}`, {
    headers: { Authorization: `Token ${apiKey}`, Accept: "application/json" },
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(`Crustdata rejected the API key (${res.status}) — check it in Options`);
  }
  if (!res.ok) {
    throw new Error(`Crustdata enrich error: ${res.status} ${await res.text()}`);
  }

  const raw = unwrapCrustdataResponse(await res.json());
  if (!raw || (!raw.name && !raw.first_name)) {
    throw new Error("Crustdata has no profile for that URL yet");
  }
  return normalizeCrustdataProfile(raw, profileUrl);
}

/** Which stored key the selected provider authenticates with. */
export function enrichmentTokenFor(
  provider: EnrichmentProvider,
  settings: Pick<AppSettings, "enrichmentApiToken" | "crustdataApiKey">,
): string {
  if (provider === "crustdata") return settings.crustdataApiKey || settings.enrichmentApiToken;
  return settings.enrichmentApiToken;
}

export async function enrichProfile(
  provider: EnrichmentProvider,
  apiToken: string,
  profileUrl: string,
): Promise<ProfileData> {
  switch (provider) {
    case "apify":
      return enrichViaApify(apiToken, profileUrl);
    case "crustdata":
      return enrichViaCrustdata(apiToken, profileUrl);
    case "pdl":
      return enrichViaPdl(apiToken, profileUrl);
    default:
      throw new Error("No enrichment provider configured");
  }
}
