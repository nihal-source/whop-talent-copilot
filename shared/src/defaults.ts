import type { PersonaConfig, PersonalStructure, TalentBarConfig } from "./types";

export const DEFAULT_TALENT_BAR: TalentBarConfig = {
  gtmAgeCap: 30,
  engineeringAgeCap: 45,
  engineeringCompanies: [
    "Sigma",
    "Langchain",
    "LangChain",
    "Uniswap",
    "xAI",
    "TikTok",
    "Tiktok",
    "Icon",
    "Mercor",
    "Palantir",
    "Corgi",
    "Ripple",
    "Afterquery",
    "Meta Superintelligence",
    "CloudKitchens",
    "Factory",
    "Glean",
    "Applied Intuition",
    "Cohere",
    "Together AI",
    "Fireworks AI",
    "Thinking Machines",
    "Cognition",
    "Decagon",
    "OpenAI",
  ],
  chineseCompanies: ["DoorDash", "Ambient AI"],
  gtmSalesCompanies: ["Ramp"],
  preSeriesCCompanies: [],
  targetSchools: ["MIT", "Stanford", "Caltech", "California Institute of Technology"],
  hackathonKeywords: ["IOI", "IMO", "ICPC", "HackMIT", "hackathon winner"],
  gtmWeights: {
    founder: 25,
    foundingSales: 25,
    startupSales: 20,
    agencyOwner: 20,
    tier1Sales: 20,
    presidentsClub: 20,
  },
  engineeringWeights: {
    tier1Eng: 25,
    founder: 25,
    ioi: 30,
    imo: 30,
    hackathon: 15,
    targetSchool: 15,
    preSeriesC: 10,
    chineseTier: 10,
  },
};

export const WHOP_PROOF_POINTS: Record<string, string> = {
  team_ex_founders: "75% ex-founders",
  team_pedigree: "top 0.1% of ppl in their 20's; half ex-millionaires",
  company_scale: "unicorn'd w/ only 60 ppl; 1.6B val; 300M/month processing",
  notable_hire: "mercor eng #1",
  culture: "autonomy + actually building",
  ae_comp: "175k base, 500k OTE (top make 7 figs)",
  general_comp: "130k base, 370k OTE (most make 500k-1M)",
  equity: "a ton of equity; u get equity",
  location: "NYC",
};

/**
 * The two shapes an initial Personal message may take. Everything the prompt,
 * the Options hints, and the side panel say about message structure comes from
 * here so the UI and the model can never drift apart.
 */
export const PERSONAL_SHAPES: Record<
  PersonalStructure,
  { key: PersonalStructure; number: 1 | 2; label: string; shortLabel: string; recipe: string; whopPitchAllowed: boolean }
> = {
  personal_obs_only: {
    key: "personal_obs_only",
    number: 1,
    label: "Shape 1 — observation → question",
    shortLabel: "Shape 1 (observation → question)",
    recipe:
      "One concrete, true observation about them, then one real question about it. No Whop pitch, no comp, no proof points, no ask for a call.",
    whopPitchAllowed: false,
  },
  personal_obs_value: {
    key: "personal_obs_value",
    number: 2,
    label: "Shape 2 — observation → value prop → question",
    shortLabel: "Shape 2 (observation → value prop → question)",
    recipe:
      "One concrete, true observation about them, then ONE short line on why Whop might be worth a look (at most one proof point), then one question.",
    whopPitchAllowed: true,
  },
};

export const DEFAULT_PERSONAL_STRUCTURE: PersonalStructure = "personal_obs_only";

/** Settings written before the two-shape rewrite stored "personal_full". */
export function normalizePersonalStructure(value: unknown): PersonalStructure {
  if (value === "personal_obs_only" || value === "personal_obs_value") return value;
  if (value === "personal_full") return "personal_obs_value";
  return DEFAULT_PERSONAL_STRUCTURE;
}

export function otherPersonalStructure(structure: PersonalStructure): PersonalStructure {
  return structure === "personal_obs_only" ? "personal_obs_value" : "personal_obs_only";
}

export const DEFAULT_PERSONAS: Record<"personal" | "founder", PersonaConfig> = {
  personal: {
    id: "personal",
    label: "Personal",
    styleGuide: {
      tone: "Casual, lowercase, Gen-Z. Observation-led and curious — a real person noticing something, not a recruiter opening a pitch.",
      length: "Shape 1: 18-45 words. Shape 2: 30-60 words. Follow-ups: 25-55 words. Short is fine — never pad.",
      mustInclude: ["one concrete detail that is true of this specific person", "a real question"],
      mustAvoid: [
        "I hope this finds you well",
        "corporate recruiter speak",
        "formal English corrections",
        "multi-line Whop pitches",
        "ceiling framing (\"higher ceiling than what ur doing at X\")",
        "stacking proof points / comp stats",
        "invented quota, #1 rankings, mutual connections, or funding rounds",
        "filler added just to reach a word count",
      ],
    },
    framework: {
      initial: {
        steps: [
          {
            instruction: "One concrete, true observation drawn from the profile or verified context",
            templateLine: "yoo {shortName} — {observation}",
          },
          {
            instruction:
              "Shape 2 only: one short line on why Whop might be worth a look (one sentence, at most one proof point). Omit entirely in Shape 1.",
          },
          {
            instruction: "One real question about the observation — curiosity, not a closing line",
            templateLine: "curious how that's been?",
          },
        ],
        maxSentences: 4,
      },
      followUp1: { steps: [{ instruction: "Light bump on the same observation, no guilt, no new pitch" }], toneShift: "lighter" },
      followUp2: { steps: [{ instruction: "Graceful close or one final short ask" }], toneShift: "final" },
    },
    senderContext: { name: "", title: "Recruiting", company: "Whop", pitchLine: "scaling the team @ whop" },
    examples: {
      initial: `yoo kasyap — saw ur at brief now after founding sherpa. what made u go back to building inside someone else's company? curious how that's been so far`,
      initialWithValueProp: `yoo kasyap — noticed u've been on brief's infra since the seed round. we're building out eng @ whop rn and the autonomy is genuinely the selling point. worth a quick chat abt it?`,
      followUp1: `hey bumping this — still curious abt the brief infra thing tbh. no stress if timing's bad, just figured i'd ask once more. u around this week?`,
      followUp2: `all good if the timing's off — gonna stop bugging u after this lol. dms stay open if u ever get curious abt whop. keep doing ur thing man`,
    },
    followUpCadenceDays: [4, 9],
  },
  founder: {
    id: "founder",
    label: "Founder",
    styleGuide: {
      tone: "Ultra-casual, slang-forward, punchy.",
      length: "50-70 words for every message (initial and follow-ups).",
      mustInclude: ["yo", "u", "lowercase"],
      mustAvoid: ["multi-paragraph pitches", "comp stats unless direct variant", "recruiter-speak"],
    },
    framework: {
      initial: {
        steps: [
          { instruction: "Cracked/subtle observation or direct ask, expanded with one profile-specific line to hit 50-70 words", templateLine: "yoo u look cracked" },
        ],
      },
      followUp1: { steps: [{ instruction: "Casual bump with a fresh angle, 50-70 words" }] },
      followUp2: { steps: [{ instruction: "Graceful close, 50-70 words" }] },
    },
    senderContext: { name: "", title: "Founder", company: "Whop", pitchLine: "scaling the team out @ whop" },
    examples: {
      initial:
        "yo what made u jump to unreal labs haha - been watching what ur building and it looks genuinely cracked. we're scaling the team out @ whop rn and imo the kind of stuff ur into lines up scary well with where we're headed. worth a quick convo? no pressure at all, just think u'd vibe with the crew",
      followUp1:
        "bumping this to the top haha - still think there's smth here worth exploring. we're moving fast on hiring and i'd hate for u to miss the window if the timing's actually right. even a 15 min call could be worth it. down to chat this week or is now just not the moment for u?",
      followUp2:
        "all good if the timing's off, genuinely no hard feelings - i know ur heads down on ur own thing rn. gonna stop bugging u after this one lol. if anything changes down the line or ur ever just curious what we're building @ whop, my dms are always open. keep crushing it either way man",
    },
    followUpCadenceDays: [4, 9],
  },
};

export const NAME_SHORTENINGS: Record<string, string> = {
  jonathan: "john",
  christopher: "chris",
  alexander: "alex",
  michael: "mike",
  william: "will",
  robert: "rob",
  nicholas: "nick",
  benjamin: "ben",
  matthew: "matt",
};
