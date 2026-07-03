import { makeAccount } from "../identity";
import { emptyResult, type ImportedContact, type ParseResult } from "./types";

/**
 * X (Twitter) parsers. Preferred ingestion is OAuth (handled in the web app);
 * these functions cover the user-uploaded archive fallback and normalizing OAuth
 * API responses into the shared contact shape.
 */

/**
 * The archive stores data as `window.YTD.<name>.part0 = [ ... ]`. Strip the
 * assignment prefix to get valid JSON.
 */
export function parseTwitterJsFile<T = unknown>(jsText: string): T[] {
  const idx = jsText.indexOf("=");
  const jsonPart = idx >= 0 ? jsText.slice(idx + 1) : jsText;
  const trimmed = jsonPart.trim().replace(/;\s*$/, "");
  try {
    return JSON.parse(trimmed) as T[];
  } catch {
    return [];
  }
}

interface FollowingEntry {
  following?: { accountId?: string; userLink?: string };
}
interface FollowerEntry {
  follower?: { accountId?: string; userLink?: string };
}

/** Archive following.js / follower.js only contain account IDs + a userLink. */
export function parseTwitterArchiveFollows(
  jsText: string,
  direction: "following" | "follower",
): ParseResult {
  const result = emptyResult(`x_archive_${direction}`);
  const raw = parseTwitterJsFile<FollowingEntry & FollowerEntry>(jsText);
  for (const entry of raw) {
    const node = direction === "following" ? entry.following : entry.follower;
    const link = node?.userLink || "";
    if (!link) {
      result.skipped++;
      continue;
    }
    const account = makeAccount("x", link);
    if (!account.handle) {
      result.skipped++;
      continue;
    }
    result.contacts.push({
      name: account.handle,
      accounts: [account],
      edgeType: direction === "following" ? "follows" : "followed_by",
      source: "x_export",
      confidence: 0.85,
      evidence: [],
    });
  }
  if (result.contacts.length === 0) {
    result.warnings.push("No handles resolved — archive stores IDs; handles come from userLink");
  }
  return result;
}

export interface XApiUser {
  id: string;
  username: string;
  name: string;
}

/** Normalize the X API v2 followers/following payload into contacts. */
export function normalizeXApiFollows(
  users: XApiUser[],
  direction: "following" | "follower",
): ImportedContact[] {
  return users
    .filter((u) => u.username)
    .map((u) => ({
      name: u.name || u.username,
      accounts: [makeAccount("x", u.username)],
      edgeType: direction === "following" ? "follows" : "followed_by",
      source: "x_oauth" as const,
      confidence: 0.95,
      evidence: [],
    }));
}
