import { NextResponse } from "next/server";
import { z } from "zod";
import { setByocToken, normalisePhone } from "@/lib/byoc";
import { sendWhatsApp } from "@/lib/whatsapp/gupshup";
import { SwiggyClient } from "@/lib/mcp/swiggy-client";
import { safeLog } from "@/lib/redact";
import { newRequestId, withLogContext } from "@/lib/log-context";
import { clientIp, connectLimiter } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PhoneRegex = /^\+?\d{10,15}$/;

const ConnectBody = z.object({
  phone: z.string().regex(PhoneRegex, "Phone must be 10–15 digits with optional + prefix"),
  token: z.string().min(20, "Bearer token looks too short"),
  inviteCode: z.string().optional(),
});

/**
 * Accepts a BYOC bearer token + WhatsApp phone, encrypts and stores it,
 * then sends a confirmation to the user's WhatsApp.
 *
 * Gated by CONNECT_INVITE_CODE in env (when set) — beta mode.
 */
export async function POST(req: Request) {
  return withLogContext({ requestId: newRequestId() }, () => handle(req));
}

async function handle(req: Request) {
  const limiter = connectLimiter();
  if (limiter) {
    const ip = clientIp(req);
    const { success, reset } = await limiter.limit(`ip:${ip}`);
    if (!success) {
      safeLog("connect.ratelimited", { ip });
      const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
      return NextResponse.json(
        { error: "Too many attempts. Try again later." },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }
  }

  const raw = await req.json().catch(() => null);
  const parsed = ConnectBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  const expectedInvite = process.env.CONNECT_INVITE_CODE;
  if (expectedInvite && parsed.data.inviteCode !== expectedInvite) {
    return NextResponse.json({ error: "Invalid invite code" }, { status: 403 });
  }

  const phone = normalisePhone(parsed.data.phone);

  if (process.env.LASTBITE_OFFLINE !== "1" && process.env.SKIP_TOKEN_VALIDATION !== "1") {
    const ok = await SwiggyClient.validate(parsed.data.token);
    if (!ok) {
      return NextResponse.json(
        {
          error:
            "Token didn't authenticate against Swiggy MCP. Re-copy from Claude Desktop and try again.",
        },
        { status: 401 },
      );
    }
  }

  await setByocToken(phone, parsed.data.token);
  safeLog("byoc.registered", { phone });

  await sendWhatsApp(
    phone,
    "You're connected. Send me an order any time, e.g. 'biryani Paradise ₹500'. Reply FORGET ME to revoke.",
  ).catch(() => {});

  return NextResponse.json({ ok: true, phone });
}
