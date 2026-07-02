import type {
  ContextFact,
  FounderVariant,
  OutreachPersona,
  PersonaConfig,
  PersonalStructure,
  ProfileData,
  RecipientSegment,
  TalentTrack,
  TouchType,
} from "./types";
import { WHOP_PROOF_POINTS } from "./defaults";
import { MESSAGE_WORD_MAX, MESSAGE_WORD_MIN, buildAllowedFacts } from "./validation";

export function buildSystemPrompt(
  persona: PersonaConfig,
  segment: RecipientSegment,
  track: TalentTrack,
  founderVariant?: FounderVariant,
  personalStructure?: PersonalStructure,
): string {
  const proofLines =
    founderVariant === "founder_direct" || persona.id === "personal"
      ? Object.entries(WHOP_PROOF_POINTS)
          .map(([k, v]) => `- ${k}: ${v}`)
          .join("\n")
      : "(Whop proof not allowed for this variant — observation only)";

  const segmentGuidance =
    segment.ageBand === "20s"
      ? "Use max slang, cracked/lit OK, equity angle, shorter."
      : segment.ageBand === "40s" || segment.ageBand === "50s+"
        ? "Less slang, comp/ceiling angle, respect tenure, no bro/lol."
        : "Balanced casual tone.";

  const personaRules =
    persona.id === "founder"
      ? `Founder voice: keep it punchy and casual. Variant: ${founderVariant ?? "founder_subtle_career"}. No multi-paragraph Whop pitch unless founder_direct.`
      : `Personal voice: ${personalStructure ?? "personal_full"}. Structure B = observation-led, still land within the word range below.`;

  return `You write LinkedIn outreach for Whop recruiting. Persona: ${persona.label}.

LENGTH (HARD REQUIREMENT):
- EVERY message (initial AND every follow-up) MUST be between ${MESSAGE_WORD_MIN} and ${MESSAGE_WORD_MAX} words.
- Do not go under ${MESSAGE_WORD_MIN} or over ${MESSAGE_WORD_MAX} words. Count words before returning.
- If you would fall short, add one more concrete, profile-specific line rather than filler.

STYLE:
- Tone: ${persona.styleGuide.tone}
- Length: ${MESSAGE_WORD_MIN}-${MESSAGE_WORD_MAX} words per message (overrides any other length guidance)
- Must include: ${persona.styleGuide.mustInclude.join("; ")}
- Must avoid: ${persona.styleGuide.mustAvoid.join("; ")}

${personaRules}

RECIPIENT SEGMENT: ${segment.segmentKey} (${segment.roleFamily}, ${segment.ageBand})
${segmentGuidance}

TRACK: ${track}

WHOP PROOF LIBRARY (use sparingly, only when relevant):
${proofLines}

RULES:
- Never invent facts. You may ONLY reference facts from PROFILE, NOTES, ALLOWED FACTS, or VERIFIED EXTERNAL CONTEXT (all provided in the user message).
- Do NOT claim mutual connections, meetings, referrals, or events unless explicitly in NOTES
- Do NOT invent funding rounds, promotions, or social posts. You MAY reference a funding round, launch, news item, or post ONLY if it appears verbatim in VERIFIED EXTERNAL CONTEXT.
- When you use an item from VERIFIED EXTERNAL CONTEXT, reference it naturally and accurately — do not exaggerate or add details beyond what the context states.
- If a detail is missing, use a generic observation or ask a question — do not guess
- Mirror casual spelling (u, w/, yo) — do not correct to formal English
- Never blend Personal and Founder voice
- Only use Whop proof points when persona/variant allows pitching Whop
- Use ONLY names/companies/schools from ALLOWED FACTS or VERIFIED EXTERNAL CONTEXT

EXAMPLE INITIAL:
${persona.examples.initial}`;
}

function formatAllowedFacts(profile: ProfileData, notes: string, allowWhopProof: boolean): string {
  const facts = buildAllowedFacts(profile, notes, allowWhopProof);
  return `ALLOWED FACTS (only reference these — nothing else):
- Names: ${facts.names.join(", ") || "none"}
- Companies: ${facts.companies.join(", ") || "none"}
- Schools: ${facts.schools.join(", ") || "none"}
- Titles: ${facts.titles.slice(0, 5).join(", ") || "none"}
- User notes: ${notes.trim() || "none"}
- Whop pitch allowed: ${allowWhopProof ? "yes" : "no — observation only"}`;
}

function formatExternalContext(context: ContextFact[]): string {
  const enabled = context.filter((c) => c.enabled && c.text.trim());
  if (!enabled.length) return "";
  const lines = enabled
    .map((c) => {
      const meta = [c.type, c.date, c.source].filter(Boolean).join(", ");
      return `- [${meta}] ${c.text}`;
    })
    .join("\n");
  return `\nVERIFIED EXTERNAL CONTEXT (real, sourced — you MAY reference these; do not add details beyond them):
${lines}\n`;
}

export function buildUserPrompt(
  profile: ProfileData,
  segment: RecipientSegment,
  notes: string,
  touchType: TouchType,
  topPerformers: string[] = [],
  opts?: { allowWhopProof?: boolean; context?: ContextFact[] },
): string {
  const allowWhopProof = opts?.allowWhopProof ?? true;
  const externalContext = formatExternalContext(opts?.context ?? []);
  const performers =
    topPerformers.length > 0
      ? `\nTop performing messages for this segment (mirror style, do NOT copy facts from these):\n${topPerformers.join("\n---\n")}`
      : "";

  const expSummary =
    profile.experience.length > 0
      ? profile.experience.slice(0, 5).map((e) => `${e.title} @ ${e.company}`).join("; ")
      : "unknown (not scraped)";

  return `Generate outreach for touch type: ${touchType}

${formatAllowedFacts(profile, notes, allowWhopProof)}
${externalContext}
PROFILE (scraped — treat as source of truth):
- Name: ${profile.name} (first: ${profile.firstName}, short: ${profile.shortName})
- Headline: ${profile.headline || "unknown"}
- Company: ${profile.currentCompany || "unknown"}
- Title: ${profile.currentTitle || "unknown"}
- Location: ${profile.location || "unknown"}
- About: ${profile.about ? profile.about.slice(0, 500) : "not available"}
- Experience: ${expSummary}
- Education: ${profile.education.map((e) => e.school).join(", ") || "not scraped"}
- Scrape quality: ${profile.scrapeHealth}

SEGMENT: ${JSON.stringify(segment)}
NOTES: ${notes || "none"}
${performers}

Each of initial, followUp1, and followUp2 MUST be ${MESSAGE_WORD_MIN}-${MESSAGE_WORD_MAX} words.

Return JSON only (no markdown):
{
  "initial": "...",
  "followUp1": "...",
  "followUp2": "...",
  "reasoning": "internal only — list which allowed facts you used and confirm each message is ${MESSAGE_WORD_MIN}-${MESSAGE_WORD_MAX} words"
}`;
}

import { parseDraftJson } from "./validation";

export async function callAnthropic(
  apiKey: string,
  system: string,
  user: string,
): Promise<{ initial: string; followUp1: string; followUp2: string }> {
  if (!apiKey.trim()) throw new Error("Anthropic API key is required");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error: ${res.status} ${err}`);
  }

  const data = (await res.json()) as {
    content: Array<{ type: string; text: string }>;
  };
  const text = data.content.find((c) => c.type === "text")?.text ?? "";
  return parseDraftJson(text);
}
