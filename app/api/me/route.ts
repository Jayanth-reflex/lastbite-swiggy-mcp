import { NextResponse } from "next/server";
import { readSessionCookie } from "@/lib/session";
import {
  effectiveMode,
  getUserMode,
  realOrdersGloballyEnabled,
} from "@/lib/user-prefs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = readSessionCookie(req.headers.get("cookie"));
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  const userMode = await getUserMode(session.phone);
  const eff = await effectiveMode(session.phone);
  return NextResponse.json({
    authenticated: true,
    phone: session.phone,
    mode: userMode,
    effectiveMode: eff,
    realOrdersAvailable: realOrdersGloballyEnabled(),
  });
}
