import type { Person, Platform, PlatformAccount } from "./types";

/** Lowercase, strip accents/punctuation, collapse whitespace for name matching. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract the stable identifier from a platform URL/handle.
 * LinkedIn -> vanity slug, X/IG -> username without @.
 */
export function normalizeHandle(platform: Platform, raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (platform === "linkedin") {
    const m = value.match(/linkedin\.com\/in\/([^/?#]+)/i);
    const slug = m ? m[1] : value.replace(/^\/+|\/+$/g, "");
    return decodeURIComponent(slug).toLowerCase();
  }
  // x / instagram
  const m = value.match(/(?:x\.com|twitter\.com|instagram\.com)\/@?([^/?#]+)/i);
  const handle = m ? m[1] : value.replace(/^@/, "");
  return handle.toLowerCase();
}

export function canonicalUrl(platform: Platform, handle: string): string {
  switch (platform) {
    case "linkedin":
      return `https://www.linkedin.com/in/${handle}`;
    case "x":
      return `https://x.com/${handle}`;
    case "instagram":
      return `https://www.instagram.com/${handle}`;
  }
}

export function makeAccount(platform: Platform, raw: string): PlatformAccount {
  const handle = normalizeHandle(platform, raw);
  return { platform, handle, url: handle ? canonicalUrl(platform, handle) : undefined };
}

/** A confident match requires a shared platform handle. Name+company is a weak hint only. */
export function accountsMatch(a: PlatformAccount[], b: PlatformAccount[]): boolean {
  return a.some((x) =>
    b.some((y) => x.platform === y.platform && x.handle && x.handle === y.handle),
  );
}

/**
 * Merge candidate into a resolution decision. Returns "merge" only when a shared
 * handle exists; "distinct" otherwise. Name collisions never auto-merge — the UI
 * must ask the user to disambiguate.
 */
export function resolveIdentity(
  existing: Person,
  candidate: Pick<Person, "normalizedName" | "accounts" | "company">,
): "merge" | "distinct" | "ambiguous" {
  if (accountsMatch(existing.accounts, candidate.accounts)) return "merge";
  const sameName = existing.normalizedName === candidate.normalizedName;
  if (!sameName) return "distinct";
  const sameCompany =
    !!existing.company &&
    !!candidate.company &&
    existing.company.toLowerCase() === candidate.company.toLowerCase();
  // Same name, no shared handle: ambiguous even with matching company.
  return sameCompany ? "ambiguous" : "distinct";
}

/** Union platform accounts, de-duplicated by platform+handle. */
export function mergeAccounts(
  a: PlatformAccount[],
  b: PlatformAccount[],
): PlatformAccount[] {
  const byKey = new Map<string, PlatformAccount>();
  for (const acc of [...a, ...b]) {
    if (!acc.handle) continue;
    const key = `${acc.platform}:${acc.handle}`;
    if (!byKey.has(key)) byKey.set(key, acc);
  }
  return [...byKey.values()];
}
