import { NextResponse } from "next/server";
import { resolveSession } from "@/lib/auth";
import { resolveTarget } from "@/lib/target-service";
import { rankPathsForTarget } from "@/lib/graph-service";
import { preflight, withCors } from "@/lib/cors";

export function OPTIONS(req: Request) {
  return preflight(req);
}

/**
 * Resolve a target (PDL or manual) and immediately rank intro paths to them.
 * Accepts either a browser cookie session or a bearer token (Chrome extension),
 * so the same endpoint powers the web app and the in-LinkedIn quick lookup.
 */
export async function POST(req: Request) {
  const session = await resolveSession(req);
  if (!session) return withCors(req, NextResponse.json({ error: "unauthenticated" }, { status: 401 }));

  const body = await req.json().catch(() => ({}));
  const { name, company, linkedinUrl } = body as {
    name?: string;
    company?: string;
    linkedinUrl?: string;
  };
  if (!name?.trim() && !linkedinUrl?.trim()) {
    return withCors(req, NextResponse.json({ error: "provide a name or LinkedIn URL" }, { status: 400 }));
  }

  const resolved = await resolveTarget(session, { name, company, linkedinUrl });
  const ranked = await rankPathsForTarget(session.org.id, resolved.person.id);

  return withCors(
    req,
    NextResponse.json({
      target: resolved.person,
      matchConfidence: resolved.matchConfidence,
      source: resolved.source,
      alternatives: resolved.alternatives ?? [],
      paths: ranked.paths,
    }),
  );
}
