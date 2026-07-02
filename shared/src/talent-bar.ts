import type {
  ProfileData,
  TalentBarConfig,
  TalentFitScore,
  TalentSignals,
  TalentTrack,
} from "./types";
import { matchesCompanyStrict } from "./validation";

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

function textBlob(profile: ProfileData, notes = ""): string {
  const edu = profile.education.map((e) => `${e.school} ${e.degree ?? ""} ${e.endYear ?? ""}`).join(" ");
  const exp = profile.experience.map((e) => `${e.title} ${e.company}`).join(" ");
  return normalize(`${profile.headline} ${profile.about} ${edu} ${exp} ${notes}`);
}

function inferAge(profile: ProfileData): number | null {
  const gradYears = profile.education
    .map((e) => e.endYear)
    .filter((y): y is number => typeof y === "number" && y > 1970);
  if (gradYears.length > 0) {
    const latest = Math.max(...gradYears);
    const yearsSinceGrad = new Date().getFullYear() - latest;
    return 22 + yearsSinceGrad;
  }
  const expYears = profile.experience
    .map((e) => {
      const m = e.startDate?.match(/(\d{4})/);
      return m ? parseInt(m[1], 10) : null;
    })
    .filter((y): y is number => y !== null);
  if (expYears.length > 0) {
    const earliest = Math.min(...expYears);
    return 22 + (new Date().getFullYear() - earliest);
  }
  return null;
}

function matchesCompany(company: string, list: string[]): boolean {
  return matchesCompanyStrict(company, list);
}

function hasKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((k) => text.includes(normalize(k)));
}

export function detectSignals(
  profile: ProfileData,
  track: TalentTrack,
  config: TalentBarConfig,
  notes = "",
): TalentSignals {
  const blob = textBlob(profile, notes);
  const titles = profile.experience.map((e) => normalize(e.title)).join(" ");
  const companies = profile.experience.map((e) => e.company);

  const inferredAge = inferAge(profile);
  const ageCap = track === "gtm" ? config.gtmAgeCap : config.engineeringAgeCap;
  const passesAgeGate = inferredAge === null || inferredAge <= ageCap;

  const isFounderOrExFounder =
    /\b(founder|co-founder|cofounder|founding)\b/.test(blob) ||
    hasKeyword(notes, ["founder", "ex-founder"]);

  const isFoundingSales =
    /\b(founding sales|first sales|employee #?[1-5] sales|built sales)\b/.test(titles) ||
    /\bfounding ae\b/.test(titles);

  const isSalesRole = /\b(sales|ae|account executive|bdr|sdr|revenue)\b/.test(titles);

  const isPreSeriesCEmployer = companies.some(
    (c) => matchesCompany(c, config.preSeriesCCompanies) || /\b(series [ab]|seed)\b/i.test(notes),
  );

  const isStartupSales = isSalesRole && (isPreSeriesCEmployer || /\bstartup sales\b/i.test(blob));

  const isAgencyOwner =
    /\b(agency owner|ran agency|founded agency)\b/.test(blob) || hasKeyword(notes, ["agency owner"]);

  const isTier1SalesCompany = companies.some((c) => matchesCompany(c, config.gtmSalesCompanies));

  const isPresidentsClub =
    /\bpresident'?s club\b/.test(blob) || hasKeyword(notes, ["president's club", "presidents club"]);

  const isFoundingEngineer =
    /\b(founding engineer|founding eng|employee #?[1-9]|first engineer)\b/.test(titles);

  const isTier1EngCompany = companies.some((c) => matchesCompany(c, config.engineeringCompanies));

  const isIoiMedalist = /\bioi\b/.test(blob) && /\b(medal|gold|silver|bronze|finalist)\b/.test(blob);
  const isImoMedalist = /\bimo\b/.test(blob) && /\b(medal|gold|silver|bronze|finalist)\b/.test(blob);
  const isHackathonWinner =
    hasKeyword(blob, config.hackathonKeywords.map((k) => k.toLowerCase())) ||
    /\b(hackathon winner|icpc|codeforces)\b/.test(blob);

  const isTargetSchool = profile.education.some((e) =>
    config.targetSchools.some((s) => normalize(e.school).includes(normalize(s))),
  );

  const isChineseTierCompany = companies.some((c) => matchesCompany(c, config.chineseCompanies));

  const userNotesBoost: string[] = [];
  if (notes.trim()) userNotesBoost.push(notes.trim());

  return {
    isFounderOrExFounder,
    inferredAge,
    passesAgeGate,
    isFoundingSales,
    isStartupSales,
    isAgencyOwner,
    isTier1SalesCompany,
    isPresidentsClub,
    isFoundingEngineer,
    isTier1EngCompany,
    isIoiMedalist,
    isImoMedalist,
    isHackathonWinner,
    isTargetSchool,
    isPreSeriesCStartup: isPreSeriesCEmployer,
    isChineseTierCompany,
    userNotesBoost,
  };
}

export function scoreProfile(
  profile: ProfileData,
  track: TalentTrack,
  config: TalentBarConfig,
  notes = "",
): TalentFitScore {
  const signals = detectSignals(profile, track, config, notes);
  const ageCap = track === "gtm" ? config.gtmAgeCap : config.engineeringAgeCap;
  const matchedSignals: string[] = [];
  const missingSignals: string[] = [];
  let score = 0;

  if (!signals.passesAgeGate) {
    return {
      track,
      score: 0,
      tier: "disqualified",
      matchedSignals: [],
      missingSignals: [`Over age cap (>${ageCap})`],
      ageGate: { max: ageCap, inferred: signals.inferredAge, passes: false },
      signals,
    };
  }

  if (track === "gtm") {
    const checks: [boolean, string, number][] = [
      [signals.isFounderOrExFounder, "Ex-founder / founder", config.gtmWeights.founder],
      [signals.isFoundingSales, "Founding sales", config.gtmWeights.foundingSales],
      [signals.isStartupSales, "Startup sales (pre-Series C)", config.gtmWeights.startupSales],
      [signals.isAgencyOwner, "Agency owner", config.gtmWeights.agencyOwner],
      [signals.isTier1SalesCompany, "Tier-1 sales company alumni", config.gtmWeights.tier1Sales],
      [signals.isPresidentsClub, "President's Club", config.gtmWeights.presidentsClub],
    ];
    for (const [ok, label, weight] of checks) {
      if (ok) {
        matchedSignals.push(label);
        score += weight;
      } else missingSignals.push(label);
    }
  } else {
    const checks: [boolean, string, number][] = [
      [signals.isTier1EngCompany, "Tier-1 eng company", config.engineeringWeights.tier1Eng],
      [signals.isFounderOrExFounder || signals.isFoundingEngineer, "Founder / founding engineer", config.engineeringWeights.founder],
      [signals.isIoiMedalist, "IOI medalist", config.engineeringWeights.ioi],
      [signals.isImoMedalist, "IMO medalist", config.engineeringWeights.imo],
      [signals.isHackathonWinner, "Hackathon / ICPC", config.engineeringWeights.hackathon],
      [signals.isTargetSchool, "MIT / Stanford / Caltech", config.engineeringWeights.targetSchool],
      [signals.isPreSeriesCStartup, "Pre-Series C startup", config.engineeringWeights.preSeriesC],
      [signals.isChineseTierCompany, "Chinese tier company", config.engineeringWeights.chineseTier],
    ];
    for (const [ok, label, weight] of checks) {
      if (ok) {
        matchedSignals.push(label);
        score += weight;
      } else missingSignals.push(label);
    }
  }

  score = Math.min(100, score);
  const tier = score >= 70 ? "strong" : score >= 45 ? "good" : "weak";

  return {
    track,
    score,
    tier,
    matchedSignals,
    missingSignals,
    ageGate: { max: ageCap, inferred: signals.inferredAge, passes: true },
    signals,
  };
}
