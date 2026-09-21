import type {
  ContextFact,
  DraftSet,
  FounderVariant,
  PersonaConfig,
  PersonalStructure,
  ProfileData,
  RecipientSegment,
  TalentTrack,
  TouchType,
} from "./types";
import {
  DEFAULT_PERSONAL_STRUCTURE,
  PERSONAL_SHAPES,
  WHOP_PROOF_POINTS,
  otherPersonalStructure,
} from "./defaults";
import { buildAllowedFacts, formatWordRange, wordRangeFor } from "./validation";

function shapeBlock(structure: PersonalStructure, role: "primary" | "alternate"): string {
  const shape = PERSONAL_SHAPES[structure];
  const range = formatWordRange(
    wordRangeFor(role === "primary" ? "initial" : "initialAlt", {
      persona: "personal",
      personalStructure: role === "primary" ? structure : otherPersonalStructure(structure),
    }),
  );
  const field = role === "primary" ? "initial" : "initialAlt";
  return `${shape.label} — ${range} words — return as "${field}"
  ${shape.recipe}`;
}

function personalInitialRules(structure: PersonalStructure, persona: PersonaConfig): string {
  const alt = otherPersonalStructure(structure);
  const shape1Example = persona.examples.initial;
  const shape2Example = persona.examples.initialWithValueProp ?? persona.examples.initial;

  return `INITIAL MESSAGE — TWO ALLOWED SHAPES, NOTHING ELSE:
${shapeBlock(structure, "primary")}
${shapeBlock(alt, "alternate")}

Write both. The recruiter picked ${PERSONAL_SHAPES[structure].label} as the primary, so that one goes in "initial".
Both must open on the SAME true observation — the only difference is whether a single value-prop line follows it.

THE OBSERVATION:
- Exactly one concrete fact that is true of THIS person, taken from PROFILE, ALLOWED FACTS, NOTES, or VERIFIED EXTERNAL CONTEXT.
- When nothing distinctive is available, observe something plain and verifiable (current role, current company, a past company, a school) and ask a sharper question. Never reach for a stronger-sounding fact you cannot support.
- Uncertain about something? Ask about it. A clean question always beats a guess.

THE QUESTION:
- One real question about the observation, the kind you'd actually want answered.
- Not a closing line, not "worth a quick chat?" in Shape 1.

THE VALUE PROP (Shape 2 only):
- One sentence. At most ONE proof point from the library below, and only when it connects to the observation.
- Never a paragraph, never a stack of stats, never comp numbers unless the notes say they asked.

DO NOT WRITE THE OLD TEMPLATE. These are retired and must not appear in any form:
- "ever think abt a higher ceiling than what ur doing at X"
- "we're 75% ex-founders … unicorn'd with only 60 people … mercor eng #1" strung into a pitch paragraph
- any multi-line Whop pitch, or an opener that exists only to set up the pitch

SHAPE 1 EXAMPLE (voice and shape only — never reuse its facts):
${shape1Example}

SHAPE 2 EXAMPLE (voice and shape only — never reuse its facts):
${shape2Example}`;
}

export function buildSystemPrompt(
  persona: PersonaConfig,
  segment: RecipientSegment,
  track: TalentTrack,
  founderVariant?: FounderVariant,
  personalStructure?: PersonalStructure,
): string {
  const isFounder = persona.id === "founder";
  const structure = personalStructure ?? DEFAULT_PERSONAL_STRUCTURE;

  const proofLines =
    founderVariant === "founder_direct" || !isFounder
      ? Object.entries(WHOP_PROOF_POINTS)
          .map(([k, v]) => `- ${k}: ${v}`)
          .join("\n")
      : "(Whop proof not allowed for this variant — observation only)";

  const segmentGuidance =
    segment.ageBand === "20s"
      ? "Use max slang, cracked/lit OK, equity angle, shorter."
      : segment.ageBand === "40s" || segment.ageBand === "50s+"
        ? "Less slang, respect tenure, no bro/lol."
        : "Balanced casual tone.";

  const founderRange = formatWordRange(wordRangeFor("initial", { persona: "founder" }));
  const followUpRange = formatWordRange(wordRangeFor("followUp1", { persona: persona.id, personalStructure: structure }));

  const lengthRules = isFounder
    ? `LENGTH (HARD REQUIREMENT):
- EVERY message (initial AND every follow-up) MUST be between ${founderRange} words. Count before returning.
- If you would fall short, add one more concrete, profile-specific line rather than filler.`
    : `LENGTH:
- Each message has its own range, listed with its shape below. Follow-ups: ${followUpRange} words.
- Count before returning, then stop. A tight 25-word Shape 1 beats a padded 50-word one — never add filler, a second observation, or a pitch just to reach a number.`;

  const personaRules = isFounder
    ? `Founder voice: keep it punchy and casual. Variant: ${founderVariant ?? "founder_subtle_career"}. No multi-paragraph Whop pitch unless founder_direct.

EXAMPLE INITIAL:
${persona.examples.initial}`
    : personalInitialRules(structure, persona);

  return `You write LinkedIn outreach for Whop recruiting. Persona: ${persona.label}.
Every message is a DRAFT a human reviews and sends. Nothing is auto-sent.

${lengthRules}

STYLE:
- Tone: ${persona.styleGuide.tone}
- Must include: ${persona.styleGuide.mustInclude.join("; ")}
- Must avoid: ${persona.styleGuide.mustAvoid.join("; ")}

${personaRules}

RECIPIENT SEGMENT: ${segment.segmentKey} (${segment.roleFamily}, ${segment.ageBand})
${segmentGuidance}

TRACK: ${track}

WHOP PROOF LIBRARY (at most one, and only where a value prop is allowed):
${proofLines}

RULES:
- Never invent facts. You may ONLY reference facts from PROFILE, NOTES, ALLOWED FACTS, or VERIFIED EXTERNAL CONTEXT (all provided in the user message).
- Do NOT claim mutual connections, meetings, referrals, or events unless explicitly in NOTES
- Do NOT invent quota numbers, #1 or top-performer rankings, promotions, funding rounds, or social posts. You MAY reference a funding round, launch, news item, or post ONLY if it appears verbatim in VERIFIED EXTERNAL CONTEXT.
- When you use an item from VERIFIED EXTERNAL CONTEXT, reference it naturally and accurately — do not exaggerate or add details beyond what the context states.
- If a detail is missing, observe something you can support and ask a question — do not guess
- Mirror casual spelling (u, w/, yo) — do not correct to formal English
- Never blend Personal and Founder voice
- Use ONLY names/companies/schools from ALLOWED FACTS or VERIFIED EXTERNAL CONTEXT`;
}

function formatAllowedFacts(
  profile: ProfileData,
  notes: string,
  allowWhopProof: boolean,
  pitchNote: string,
): string {
  const facts = buildAllowedFacts(profile, notes, allowWhopProof);
  return `ALLOWED FACTS (only reference these — nothing else):
- Names: ${facts.names.join(", ") || "none"}
- Companies: ${facts.companies.join(", ") || "none"}
- Schools: ${facts.schools.join(", ") || "none"}
- Titles: ${facts.titles.slice(0, 5).join(", ") || "none"}
- User notes: ${notes.trim() || "none"}
- Whop pitch allowed: ${pitchNote}`;
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
  opts?: {
    allowWhopProof?: boolean;
    context?: ContextFact[];
    persona?: PersonaConfig["id"];
    personalStructure?: PersonalStructure;
  },
): string {
  const allowWhopProof = opts?.allowWhopProof ?? true;
  const persona = opts?.persona ?? "personal";
  const structure = opts?.personalStructure ?? DEFAULT_PERSONAL_STRUCTURE;
  const wantsAlt = persona === "personal";
  // The Personal persona always drafts a Shape 2 message, so the proof library is
  // available — but only that one message may use it.
  const pitchNote = !allowWhopProof
    ? "no — observation only"
    : persona === "personal"
      ? `only in the Shape 2 message (${PERSONAL_SHAPES[structure].number === 2 ? "initial" : "initialAlt"}) — never in Shape 1`
      : "yes";
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

${formatAllowedFacts(profile, notes, allowWhopProof, pitchNote)}
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

${lengthContract(persona, structure, wantsAlt)}

Return JSON only (no markdown):
{
  "initial": "...",${wantsAlt ? '\n  "initialAlt": "...",' : ""}
  "followUp1": "...",
  "followUp2": "...",
  "reasoning": "internal only — name the observation you used and where it came from, and confirm each message is inside its word range"
}`;
}

function lengthContract(
  persona: PersonaConfig["id"],
  structure: PersonalStructure,
  wantsAlt: boolean,
): string {
  const range = (key: "initial" | "initialAlt" | "followUp1") =>
    formatWordRange(wordRangeFor(key, { persona, personalStructure: structure }));

  if (persona === "founder") {
    return `Each of initial, followUp1, and followUp2 MUST be ${range("initial")} words.`;
  }

  const altShape = PERSONAL_SHAPES[otherPersonalStructure(structure)];
  const lines = [
    `- initial: ${PERSONAL_SHAPES[structure].label}, ${range("initial")} words`,
    wantsAlt ? `- initialAlt: ${altShape.label}, ${range("initialAlt")} words` : "",
    `- followUp1 and followUp2: ${range("followUp1")} words each`,
  ].filter(Boolean);

  return `WORD RANGES (do not pad to reach them):\n${lines.join("\n")}`;
}

import { parseDraftJson } from "./validation";

export async function callAnthropic(
  apiKey: string,
  system: string,
  user: string,
): Promise<DraftSet> {
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
