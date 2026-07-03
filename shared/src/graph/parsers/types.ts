import type { EdgeSource, EdgeType, InteractionEvidence, PlatformAccount } from "../types";

/**
 * Normalized output of every parser. The ingest layer turns these into Person
 * nodes + Edges relative to the importing user. Parsers never fabricate data:
 * every contact/interaction here maps 1:1 to a row in the user's own export.
 */
export interface ImportedContact {
  name: string;
  accounts: PlatformAccount[];
  company?: string;
  title?: string;
  edgeType: EdgeType;
  source: EdgeSource;
  /** Base confidence for the edge before scoring; parsers set a sensible default. */
  confidence: number;
  evidence: InteractionEvidence[];
}

export interface ParseResult {
  contacts: ImportedContact[];
  /** Rows the parser could not read (missing name/handle) — surfaced to the user. */
  skipped: number;
  /** Detected format/version for observability and versioned handling. */
  format: string;
  warnings: string[];
}

export function emptyResult(format: string): ParseResult {
  return { contacts: [], skipped: 0, format, warnings: [] };
}
