import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getStore } from "@/lib/store";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const store = await getStore();
  const consent = await store.getConsent(session.org.id, session.user.id);
  return NextResponse.json({ consent });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { shareWithTeam, introMakerOptIn, retentionDays } = body as {
    shareWithTeam?: boolean;
    introMakerOptIn?: boolean;
    retentionDays?: number;
  };
  const store = await getStore();
  await store.setConsent({
    orgId: session.org.id,
    userId: session.user.id,
    shareWithTeam: !!shareWithTeam,
    introMakerOptIn: !!introMakerOptIn,
    retentionDays: retentionDays ?? 365,
    consentedAt: new Date().toISOString(),
  });
  return NextResponse.json({ ok: true });
}
