import { makeAccount } from "../identity";
import { emptyResult, type ParseResult } from "./types";

/**
 * Instagram parser. The only compliant path for follower/following lists is the
 * user-initiated "Download Your Information" export (JSON). The Graph API does
 * not expose these lists. We read usernames + timestamps only.
 */

interface IgStringListItem {
  href?: string;
  value?: string;
  timestamp?: number;
}
interface IgRelationshipEntry {
  string_list_data?: IgStringListItem[];
}

/** followers_*.json is an array; following.json wraps it under relationships_following. */
function extractEntries(parsed: unknown): IgRelationshipEntry[] {
  if (Array.isArray(parsed)) return parsed as IgRelationshipEntry[];
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    for (const key of ["relationships_following", "relationships_followers"]) {
      if (Array.isArray(obj[key])) return obj[key] as IgRelationshipEntry[];
    }
  }
  return [];
}

export function parseInstagramFollows(
  jsonText: string,
  direction: "following" | "follower",
): ParseResult {
  const result = emptyResult(`ig_export_${direction}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    result.warnings.push("Could not parse Instagram JSON export");
    return result;
  }
  const entries = extractEntries(parsed);
  for (const entry of entries) {
    const item = entry.string_list_data?.[0];
    const username = item?.value || (item?.href ? makeAccount("instagram", item.href).handle : "");
    if (!username) {
      result.skipped++;
      continue;
    }
    const account = makeAccount("instagram", username);
    result.contacts.push({
      name: account.handle,
      accounts: [account],
      edgeType: direction === "following" ? "follows" : "followed_by",
      source: "ig_export",
      confidence: 0.85,
      evidence: [],
    });
  }
  return result;
}
