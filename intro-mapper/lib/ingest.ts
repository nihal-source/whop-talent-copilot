import {
  parseInstagramFollows,
  parseLinkedInConnections,
  parseTwitterArchiveFollows,
  type ParseResult,
} from "./shared";

/**
 * Route an uploaded export file to the correct parser based on its filename and
 * contents. Supports the user-initiated exports that are compliant to process:
 * LinkedIn Connections.csv, X archive follower/following .js, and Instagram
 * followers/following .json.
 */
export function parseUpload(filename: string, content: string): ParseResult {
  const lower = filename.toLowerCase();

  if (lower.endsWith(".csv") || /connection/.test(lower)) {
    return parseLinkedInConnections(content);
  }

  if (lower.includes("following") && lower.endsWith(".js")) {
    return parseTwitterArchiveFollows(content, "following");
  }
  if (lower.includes("follower") && lower.endsWith(".js")) {
    return parseTwitterArchiveFollows(content, "follower");
  }

  if (lower.endsWith(".json")) {
    const direction = lower.includes("following") ? "following" : "follower";
    return parseInstagramFollows(content, direction);
  }

  // Unknown extension: sniff the content.
  if (content.trimStart().startsWith("window.YTD")) {
    const direction = lower.includes("following") ? "following" : "follower";
    return parseTwitterArchiveFollows(content, direction);
  }
  if (/first name/i.test(content.slice(0, 500))) {
    return parseLinkedInConnections(content);
  }

  return {
    contacts: [],
    skipped: 0,
    format: "unknown",
    warnings: [`Could not detect export format for "${filename}"`],
  };
}
