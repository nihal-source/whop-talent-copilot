import type { ContextFact, ContextFactType, ProfileData } from "./types";

/**
 * Pluggable "context" providers that gather timely, sourced facts (company news,
 * funding, launches, the person's own posts/interviews) to personalize outreach
 * beyond the static LinkedIn profile. Every fact carries a source + URL so it can
 * be reviewed by the user and fed to the model as explicitly-allowed context.
 *
 * Add more providers (a LinkedIn-posts scraper, a dedicated news API, etc.) by
 * implementing a fetch + mapping into ContextFact[] and wiring it into
 * fetchProfileContext.
 */
export type ContextProvider = "none" | "tavily";

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function classify(text: string, topic: "news" | "general"): ContextFactType {
  if (/\b(raise[sd]?|funding|series [a-e]\b|seed round|valuation|\$\s?\d+(\.\d+)?\s?[mMbB])\b/.test(text)) {
    return "funding";
  }
  return topic === "news" ? "news" : "web";
}

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
  published_date?: string;
}

async function tavilySearch(
  token: string,
  query: string,
  topic: "news" | "general",
  maxResults: number,
): Promise<TavilyResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      query,
      topic,
      max_results: maxResults,
      search_depth: "basic",
      include_answer: false,
      ...(topic === "news" ? { time_range: "year" } : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(`Tavily API error: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { results?: TavilyResult[] };
  return Array.isArray(data.results) ? data.results : [];
}

export function buildContextQueries(profile: ProfileData): { query: string; topic: "news" | "general" }[] {
  const queries: { query: string; topic: "news" | "general" }[] = [];
  const company = profile.currentCompany?.trim();
  const name = profile.name?.trim();

  if (company && company.toLowerCase() !== "unknown") {
    queries.push({
      query: `${company} funding OR launch OR product OR announcement`,
      topic: "news",
    });
  }
  if (name && name !== "Unknown") {
    queries.push({
      query: `${name}${company && company.toLowerCase() !== "unknown" ? ` ${company}` : ""} interview OR post OR announcement`,
      topic: "general",
    });
  }
  return queries;
}

function makeId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `ctx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

export async function fetchContextTavily(token: string, profile: ProfileData): Promise<ContextFact[]> {
  if (!token.trim()) throw new Error("Tavily API token required (set it in Options)");
  const queries = buildContextQueries(profile);
  if (!queries.length) return [];

  const facts: ContextFact[] = [];
  const seen = new Set<string>();
  let firstError: Error | null = null;

  for (const q of queries) {
    let results: TavilyResult[] = [];
    try {
      results = await tavilySearch(token, q.query, q.topic, 4);
    } catch (e) {
      firstError = e instanceof Error ? e : new Error(String(e));
      continue;
    }
    for (const r of results) {
      const content = r.content?.trim();
      const url = r.url;
      if (!content || !url || seen.has(url)) continue;
      seen.add(url);
      facts.push({
        id: makeId(),
        type: classify(`${r.title ?? ""} ${content}`, q.topic),
        text: content.slice(0, 400).trim(),
        source: hostname(url),
        url,
        date: r.published_date,
        enabled: true,
      });
    }
  }

  // Surface auth/quota errors instead of silently returning nothing.
  if (facts.length === 0 && firstError) throw firstError;
  return facts.slice(0, 8);
}

export async function fetchProfileContext(
  provider: ContextProvider,
  token: string,
  profile: ProfileData,
): Promise<ContextFact[]> {
  switch (provider) {
    case "tavily":
      return fetchContextTavily(token, profile);
    default:
      throw new Error("No context provider configured");
  }
}
