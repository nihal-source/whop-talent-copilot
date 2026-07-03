import { makeAccount } from "../identity";
import type { InteractionEvidence } from "../types";
import { parseCsvObjects } from "./csv";
import { emptyResult, type ImportedContact, type ParseResult } from "./types";

/**
 * LinkedIn export parsers. Two user-initiated formats are supported:
 *  - Connections.csv (from "Get a copy of your data" -> Connections)
 *  - The full-archive JSON/CSV files (Comments.csv, Reactions/Likes) for interaction evidence
 *
 * Only 1st-degree data belonging to the exporting user is read. No scraping,
 * no 2nd-degree mining.
 */

/** Header aliases across LinkedIn export versions (they rename columns over time). */
const NAME_KEYS = ["First Name", "FirstName"];
const LAST_KEYS = ["Last Name", "LastName"];
const URL_KEYS = ["URL", "Profile URL", "ProfileUrl"];
const COMPANY_KEYS = ["Company", "Organization"];
const POSITION_KEYS = ["Position", "Title", "Job Title"];

function pick(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    if (row[k] != null && row[k] !== "") return row[k];
  }
  return "";
}

/**
 * LinkedIn prepends a localized "Notes:" preamble before the header row. Detect
 * how many lines to skip by finding the line that looks like the real header.
 */
function detectSkipLines(text: string): number {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < Math.min(lines.length, 6); i++) {
    if (/first name/i.test(lines[i]) && /url|last name/i.test(lines[i])) {
      return i;
    }
  }
  return 0;
}

export function parseLinkedInConnections(csvText: string): ParseResult {
  const result = emptyResult("linkedin_connections_csv");
  const skip = detectSkipLines(csvText);
  const rows = parseCsvObjects(csvText, { skipLines: skip });
  if (rows.length === 0) {
    result.warnings.push("No connection rows found — is this the Connections.csv export?");
    return result;
  }

  for (const row of rows) {
    const first = pick(row, NAME_KEYS);
    const last = pick(row, LAST_KEYS);
    const name = [first, last].filter(Boolean).join(" ").trim();
    const url = pick(row, URL_KEYS);
    if (!name && !url) {
      result.skipped++;
      continue;
    }
    const accounts = url ? [makeAccount("linkedin", url)] : [];
    if (accounts.length === 0) {
      // A connection with no URL is still a real 1st-degree tie, keep by name.
      result.warnings.push(`Connection "${name}" has no profile URL — matching by name only`);
    }
    result.contacts.push({
      name: name || "Unknown",
      accounts,
      company: pick(row, COMPANY_KEYS) || undefined,
      title: pick(row, POSITION_KEYS) || undefined,
      edgeType: "connection",
      source: "linkedin_export",
      confidence: 0.9,
      evidence: [],
    });
  }
  return result;
}

interface LinkedInCommentRow {
  Date?: string;
  Link?: string;
  Message?: string;
}

/**
 * Parse Comments.csv from the full archive into interaction evidence keyed by the
 * profile URL the comment links to. We store only a pointer (the link + date),
 * never the comment body, for data minimization.
 */
export function parseLinkedInComments(
  csvText: string,
): Array<{ targetUrl?: string; evidence: InteractionEvidence }> {
  const rows = parseCsvObjects(csvText) as unknown as LinkedInCommentRow[];
  const out: Array<{ targetUrl?: string; evidence: InteractionEvidence }> = [];
  for (const row of rows) {
    const link = row.Link || "";
    const m = link.match(/linkedin\.com\/in\/[^/?#]+/i);
    out.push({
      targetUrl: m ? `https://www.${m[0]}` : undefined,
      evidence: {
        kind: "comment",
        platform: "linkedin",
        timestamp: row.Date || undefined,
        rawRef: link || undefined,
      },
    });
  }
  return out;
}
