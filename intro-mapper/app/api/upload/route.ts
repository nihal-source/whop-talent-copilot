import { NextResponse } from "next/server";
import { resolveSession } from "@/lib/auth";
import { getStore } from "@/lib/store";
import { ingestContacts } from "@/lib/graph-service";
import { parseUpload } from "@/lib/ingest";
import { preflight, withCors } from "@/lib/cors";

export function OPTIONS(req: Request) {
  return preflight(req);
}

/**
 * Accepts one or more user-initiated export files, parses them, and ingests the
 * contacts into the team graph. Requires that the user has consented to share
 * their network with the team — a hard guardrail for the shared-graph model.
 * Works from the web app (cookie) and the Chrome extension (bearer token).
 */
export async function POST(req: Request) {
  const session = await resolveSession(req);
  if (!session) return withCors(req, NextResponse.json({ error: "unauthenticated" }, { status: 401 }));

  const store = await getStore();
  const consent = await store.getConsent(session.org.id, session.user.id);
  if (!consent?.shareWithTeam) {
    return withCors(
      req,
      NextResponse.json(
        { error: "consent_required", message: "Accept data-sharing consent before uploading." },
        { status: 403 },
      ),
    );
  }

  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return withCors(req, NextResponse.json({ error: "no files provided" }, { status: 400 }));
  }

  const contacts = [];
  const perFile: Array<{ file: string; format: string; parsed: number; skipped: number; warnings: string[] }> = [];
  for (const file of files) {
    const text = await file.text();
    const result = parseUpload(file.name, text);
    contacts.push(...result.contacts);
    perFile.push({
      file: file.name,
      format: result.format,
      parsed: result.contacts.length,
      skipped: result.skipped,
      warnings: result.warnings,
    });
  }

  const ingest = await ingestContacts(session, contacts);
  return withCors(req, NextResponse.json({ files: perFile, ...ingest }));
}
