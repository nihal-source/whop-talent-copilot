import type { MessageFeatures, OutreachPersona, RecipientSegment, TouchType } from "./types";

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function detectOpener(text: string): { type: string; phrase: string } {
  const lower = text.toLowerCase().trim();
  const first = lower.split(/\s+/).slice(0, 5).join(" ");
  if (lower.startsWith("yoo")) return { type: "yoo", phrase: first };
  if (lower.startsWith("yo ")) return { type: "yo", phrase: first };
  if (/^what made u/.test(lower)) return { type: "question", phrase: first };
  if (/cracked|lit asf/.test(lower)) return { type: "cracked", phrase: first };
  if (/look lit/.test(lower)) return { type: "lit", phrase: first };
  if (/^[a-z]+ -/.test(lower)) return { type: "name_first", phrase: first };
  return { type: "other", phrase: first };
}

function detectCta(text: string): { type: string; phrase: string | null } {
  const lower = text.toLowerCase();
  if (/\bcurious about comp\b/.test(lower)) return { type: "comp", phrase: "curious about comp?" };
  if (/\bcurious\??\s*$/.test(lower) || lower.includes("curious?")) return { type: "curious", phrase: "curious?" };
  if (/\bchat\??\s*$/i.test(text.trim()) || /\bchat this week\b/i.test(lower))
    return { type: "chat", phrase: "Chat?" };
  if (lower.includes("?")) return { type: "question_hook", phrase: null };
  return { type: "none", phrase: null };
}

function detectTonality(text: string): string[] {
  const tags: string[] = ["casual"];
  const lower = text.toLowerCase();
  if (/\bu\b|\bur\b|\bw\/\b/.test(lower)) tags.push("gen_z");
  if (/\b(lol|bro|yoo|cracked|lit|asf)\b/.test(lower)) tags.push("slang");
  if (lower.includes("lol")) tags.push("lol");
  if (lower.includes("bro")) tags.push("bro");
  if (lower.includes("haha")) tags.push("haha");
  if (text === lower || /^[a-z]/.test(text)) tags.push("lowercase");
  return tags;
}

export function extractMessageFeatures(
  sentText: string,
  opts: {
    persona: OutreachPersona;
    touchType: TouchType;
    structureVariant: string;
    recipientSegment: RecipientSegment;
    firstName?: string;
    shortName?: string;
    sentAt?: Date;
    daysSinceLastTouch?: number | null;
  },
): MessageFeatures {
  const sentAt = opts.sentAt ?? new Date();
  const paragraphs = sentText.split(/\n\n+/).filter(Boolean);
  const opener = detectOpener(sentText);
  const cta = detectCta(sentText);
  const usesFirstName = opts.firstName
    ? sentText.toLowerCase().includes(opts.firstName.toLowerCase())
    : false;
  const usesShortName = opts.shortName
    ? sentText.toLowerCase().includes(opts.shortName.toLowerCase())
    : false;

  return {
    wordCount: sentText.split(/\s+/).filter(Boolean).length,
    charCount: sentText.length,
    paragraphCount: paragraphs.length,
    persona: opts.persona,
    touchType: opts.touchType,
    structureVariant: opts.structureVariant,
    recipientSegment: opts.recipientSegment,
    usesFirstName,
    usesShortName,
    openerType: opener.type,
    openerPhrase: opener.phrase,
    ctaType: cta.type,
    ctaPhrase: cta.phrase,
    triggerType: "other",
    triggerEntity: null,
    tonalityTags: detectTonality(sentText),
    sentAt: sentAt.toISOString(),
    sentHourLocal: sentAt.getHours(),
    sentDayOfWeek: sentAt.getDay(),
    daysSinceLastTouch: opts.daysSinceLastTouch ?? null,
    gotReply: false,
    gotPositiveReply: false,
    timeToReplyHours: null,
  };
}

export function aggregateMetrics(
  events: Array<{ features: MessageFeatures; type: string }>,
): import("./types").DimensionMetrics[] {
  const dimensions = ["openerType", "ctaType", "persona", "touchType"] as const;
  const results: import("./types").DimensionMetrics[] = [];

  for (const dim of dimensions) {
    const groups = new Map<string, { sends: number; replies: number; positive: number }>();
    for (const e of events) {
      if (e.type !== "message_sent") continue;
      const value = String((e.features as unknown as Record<string, unknown>)[dim] ?? "unknown");
      const g = groups.get(value) ?? { sends: 0, replies: 0, positive: 0 };
      g.sends++;
      groups.set(value, g);
    }
    for (const e of events) {
      if (e.type === "reply" || e.type === "positive_reply") {
        const value = String((e.features as unknown as Record<string, unknown>)[dim] ?? "unknown");
        const g = groups.get(value);
        if (!g) continue;
        if (e.type === "reply") g.replies++;
        if (e.type === "positive_reply") g.positive++;
      }
    }
    for (const [value, g] of groups) {
      results.push({
        dimension: dim,
        value,
        sends: g.sends,
        replies: g.replies,
        positiveReplies: g.positive,
        replyRate: g.sends ? g.replies / g.sends : 0,
        positiveRate: g.sends ? g.positive / g.sends : 0,
        positiveOfReplies: g.replies ? g.positive / g.replies : 0,
        avgTimeToReplyHours: null,
      });
    }
  }
  return results;
}
