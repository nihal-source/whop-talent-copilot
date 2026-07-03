/**
 * Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped quotes, and
 * embedded newlines. Sufficient for platform export files; no external deps so
 * it runs in the extension, the web app, and Node alike.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r") {
      // ignore; handled by \n
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/**
 * Parse CSV into objects keyed by header. LinkedIn's Connections.csv prepends a
 * few "Notes:" preamble lines before the real header, so callers can skip N rows.
 */
export function parseCsvObjects(
  text: string,
  opts: { skipLines?: number } = {},
): Record<string, string>[] {
  const cleaned =
    opts.skipLines && opts.skipLines > 0
      ? text.split(/\r?\n/).slice(opts.skipLines).join("\n")
      : text;
  const rows = parseCsv(cleaned);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    header.forEach((h, idx) => {
      obj[h] = (r[idx] ?? "").trim();
    });
    return obj;
  });
}
