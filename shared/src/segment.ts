import type { ProfileData, RecipientSegment } from "./types";

const BIG_TECH = ["google", "meta", "facebook", "apple", "amazon", "microsoft", "netflix", "tiktok"];
const CONSULTING = ["mckinsey", "bain", "bcg", "deloitte", "pwc", "kpmg", "ey", "accenture"];
const FINANCE = ["goldman", "jpmorgan", "morgan stanley", "citadel", "two sigma", "jane street"];

function inferRoleFamily(headline: string, title: string): RecipientSegment["roleFamily"] {
  const t = `${headline} ${title}`.toLowerCase();
  if (/\b(engineer|developer|swe|software|backend|frontend|fullstack|ml|ai)\b/.test(t)) return "engineering";
  if (/\b(sales|ae|account executive|bdr|sdr|revenue|gtm)\b/.test(t)) return "sales";
  if (/\b(finance|accounting|audit|cpa|partner)\b/.test(t)) return "finance";
  if (/\b(product|pm)\b/.test(t)) return "product";
  if (/\b(design|ux|ui)\b/.test(t)) return "design";
  if (/\b(ops|operations|chief of staff)\b/.test(t)) return "ops";
  return "other";
}

function inferSeniority(headline: string, title: string): RecipientSegment["seniority"] {
  const t = `${headline} ${title}`.toLowerCase();
  if (/\b(ceo|cto|cfo|chief|vp |vice president|director)\b/.test(t)) return "executive";
  if (/\b(director)\b/.test(t)) return "director";
  if (/\b(manager|head of)\b/.test(t)) return "manager";
  if (/\b(principal|staff|distinguished)\b/.test(t)) return "principal";
  if (/\b(senior|sr\.)\b/.test(t)) return "senior";
  if (/\b(junior|jr\.|intern|associate)\b/.test(t)) return "junior";
  if (/\b(mid|ii|2)\b/.test(t)) return "mid";
  return "unknown";
}

function inferEmployerType(company: string): RecipientSegment["employerType"] {
  const c = company.toLowerCase();
  if (BIG_TECH.some((b) => c.includes(b))) return "big_tech";
  if (CONSULTING.some((b) => c.includes(b))) return "consulting";
  if (FINANCE.some((b) => c.includes(b))) return "finance";
  if (/\b(agency|ventures|capital)\b/.test(c)) return "agency";
  if (/\b(inc|labs|ai|startup)\b/.test(c)) return "startup";
  return "unknown";
}

function inferIndustry(headline: string, company: string): { industry: string; bucket: string } {
  const t = `${headline} ${company}`.toLowerCase();
  if (/\b(big 4|pwc|deloitte|kpmg|ey)\b/.test(t)) return { industry: "big_4", bucket: "finance" };
  if (/\b(fintech|stripe|ramp|plaid)\b/.test(t)) return { industry: "fintech", bucket: "fintech" };
  if (/\b(crypto|web3|defi)\b/.test(t)) return { industry: "crypto", bucket: "crypto" };
  if (/\b(saas|b2b)\b/.test(t)) return { industry: "saas", bucket: "saas" };
  return { industry: "general", bucket: "general" };
}

function inferAgeBand(profile: ProfileData): { band: RecipientSegment["ageBand"]; confidence: RecipientSegment["ageConfidence"]; gradYear?: number } {
  const gradYears = profile.education
    .map((e) => e.endYear)
    .filter((y): y is number => typeof y === "number" && y > 1970);
  if (gradYears.length > 0) {
    const latest = Math.max(...gradYears);
    const age = 22 + (new Date().getFullYear() - latest);
    const band = age < 30 ? "20s" : age < 40 ? "30s" : age < 50 ? "40s" : "50s+";
    return { band, confidence: "high", gradYear: latest };
  }
  return { band: "unknown", confidence: "low" };
}

function yearsExperience(profile: ProfileData): number | undefined {
  const years = profile.experience
    .map((e) => {
      const m = e.startDate?.match(/(\d{4})/);
      return m ? parseInt(m[1], 10) : null;
    })
    .filter((y): y is number => y !== null);
  if (years.length === 0) return undefined;
  return new Date().getFullYear() - Math.min(...years);
}

export function buildRecipientSegment(profile: ProfileData, override?: Partial<RecipientSegment>): RecipientSegment {
  const title = profile.currentTitle || profile.experience[0]?.title || "";
  const company = profile.currentCompany || profile.experience[0]?.company || "";
  const { band, confidence, gradYear } = inferAgeBand(profile);
  const { industry, bucket } = inferIndustry(profile.headline, company);
  const roleFamily = inferRoleFamily(profile.headline, title);
  const employerType = inferEmployerType(company);

  const segment: RecipientSegment = {
    roleFamily,
    seniority: inferSeniority(profile.headline, title),
    currentEmployer: company,
    employerType,
    industry,
    industryBucket: bucket,
    ageBand: band,
    ageConfidence: confidence,
    graduationYear: gradYear,
    yearsExperience: yearsExperience(profile),
    segmentKey: `${roleFamily}_${band}_${employerType}`,
  };

  const merged = { ...segment, ...override };
  merged.segmentKey = `${merged.roleFamily}_${merged.ageBand}_${merged.employerType}`;
  return merged;
}

export function segmentLabel(segment: RecipientSegment): string {
  return `${segment.roleFamily} · ${segment.ageBand} · ${segment.industry}`;
}
