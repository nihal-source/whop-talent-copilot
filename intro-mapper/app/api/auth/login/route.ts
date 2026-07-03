import { NextResponse } from "next/server";
import { signIn } from "@/lib/auth";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { org, email, name } = body as { org?: string; email?: string; name?: string };
  if (!org?.trim() || !email?.trim()) {
    return NextResponse.json({ error: "org and email are required" }, { status: 400 });
  }
  const session = await signIn(org, email, name ?? email);
  return NextResponse.json({ org: session.org, user: session.user });
}
