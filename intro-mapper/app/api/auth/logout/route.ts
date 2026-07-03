import { NextResponse } from "next/server";
import { signOut } from "@/lib/auth";

export async function POST() {
  signOut();
  return NextResponse.json({ ok: true });
}
