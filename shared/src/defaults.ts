import type { PersonaConfig, TalentBarConfig } from "./types";

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

export const DEFAULT_PERSONAS: Record<"personal" | "founder", PersonaConfig> = {
  personal: {
    id: "personal",
    label: "Personal",
    styleGuide: {
      tone: "Casual, broken-English-ish, Gen-Z. Not polished corporate prose.",
      length: "50-70 words for every message (initial and follow-ups).",
      mustInclude: ["profile-specific detail", "natural fillers: lol, bro, yoo"],
      mustAvoid: ["I hope this finds you well", "corporate recruiter speak", "formal English corrections"],
    },
    framework: {
      initial: {
        steps: [
          { instruction: "Relevant observation from profile", templateLine: "yoo {shortName} — {detail}" },
          { instruction: "Inference on problem or career tension" },
          { instruction: "Quick value prop / Whop proof (1-2 lines max)" },
          { instruction: "CTA", templateLine: "curious?" },
        ],
      },
      followUp1: { steps: [{ instruction: "Light bump, same casual tone, no guilt" }], toneShift: "lighter" },
      followUp2: { steps: [{ instruction: "Graceful close or final short ask" }], toneShift: "final" },
    },
    senderContext: { name: "", title: "Recruiting", company: "Whop", pitchLine: "scaling the team @ whop" },
    examples: {
      initial: `yoo kasyap saw u followed whop - had to reach out. ever think abt a higher ceiling than what ur doing at brief rn? we're 75% ex-founders here (including mercor eng #1) and somehow unicorn'd with only 60 people, so it's a pretty wild crew. if u like real autonomy + actually building instead of just shipping tickets, that's exactly what we're hiring for. worth a quick chat?`,
      followUp1: `hey bumping this back up - still think u'd genuinely vibe with what we're building over here. i know inbound is noisy so no stress if it slipped, but the ceiling thing is real and the team's only getting more stacked. even a quick 15 min call could be worth ur time imo. u around this week to chat, or is timing just bad rn?`,
      followUp2: `all good if the timing's off, i totally get it - u've got a lot going on. gonna leave u alone after this lol. but seriously if u ever get curious abt comp, the role, or just what building @ whop actually looks like day to day, my dms stay open. no expiry on that. keep doing ur thing man, rooting for u either way`,
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
