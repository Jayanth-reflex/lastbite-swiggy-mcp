import { NextResponse } from "next/server";
import { processTurn, UserBusyError } from "@/lib/agent/runner";
import { SwiggyClient } from "@/lib/mcp/swiggy-client";
import { parseInbound, sendWhatsApp } from "@/lib/whatsapp/gupshup";
import { classifyReply } from "@/lib/agent/schemas";
import { cancelGrace, claimMessageId, isGraceActive } from "@/lib/redis";
import { clearByocToken, getByocToken, normalisePhone } from "@/lib/byoc";
import { safeLog } from "@/lib/redact";
import { newRequestId, withLogContext } from "@/lib/log-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Gate the WhatsApp webhook on a shared secret. Crucially, fail-CLOSED in
 * production when the secret env is unset — the previous behaviour returned
 * `true` (allow), which meant a missing or accidentally-cleared
 * GUPSHUP_WEBHOOK_SECRET on prod would accept arbitrary inbound payloads
 * (including ones that trigger order placement). In dev / preview we still
 * allow unsecured calls so local testing isn't a config nightmare, but we
 * log it so the gap is visible.
 */
function verifyWebhookSecret(req: Request): boolean {
  const expected = process.env.GUPSHUP_WEBHOOK_SECRET;
  if (!expected) {
    if (process.env.VERCEL_ENV === "production") {
      safeLog("whatsapp.webhook.secret-missing", { rejected: true });
      return false;
    }
    safeLog("whatsapp.webhook.secret-missing-dev", { allowed: true });
    return true;
  }
  const provided =
    req.headers.get("x-webhook-secret") ?? new URL(req.url).searchParams.get("secret");
  return provided === expected;
}

const FORGET_ME = /^forget\s*me$/i;

export async function POST(req: Request) {
  return withLogContext({ requestId: newRequestId() }, () => handle(req));
}

async function handle(req: Request) {
  if (!verifyWebhookSecret(req)) {
    return new NextResponse("forbidden", { status: 403 });
  }

  const raw = await req.json().catch((err) => {
    safeLog("whatsapp.json-parse-failed", { message: (err as Error).message });
    return null;
  });
  const inbound = parseInbound(raw);
  if (!inbound) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const phone = normalisePhone(inbound.fromPhone);
  const text = inbound.text.trim();
  // Augment the active log context with the user id so every downstream
  // safeLog call carries it.
  const ctx = (await import("@/lib/log-context")).logContext();
  if (ctx) ctx.userId = phone;
  safeLog("whatsapp.inbound", { phone, textLen: text.length, messageId: inbound.messageId });

  if (inbound.messageId) {
    const fresh = await claimMessageId(inbound.messageId);
    if (!fresh) {
      return NextResponse.json({ ok: true, deduped: true });
    }
  }

  if (FORGET_ME.test(text)) {
    await clearByocToken(phone);
    await cancelGrace(phone).catch((err) => {
      safeLog("whatsapp.forget.grace-cancel-failed", {
        phone,
        message: (err as Error).message,
      });
    });
    await sendWhatsApp(phone, "Your token and any in-flight orders have been wiped.").catch(
      (err) => {
        safeLog("whatsapp.forget.send-failed", { phone, message: (err as Error).message });
      },
    );
    return NextResponse.json({ ok: true, forgotten: true });
  }

  if (await isGraceActive(phone)) {
    if (classifyReply(text) === "stop") {
      await cancelGrace(phone);
      await sendWhatsApp(phone, "Cancelling. No order placed.");
      return NextResponse.json({ ok: true, cancelledGrace: true });
    }
    await sendWhatsApp(
      phone,
      "Hold on — finishing your previous order's grace timer. Reply STOP to cancel it, or wait a few seconds.",
    );
    return NextResponse.json({ ok: true, busyWithGrace: true });
  }

  const token = await getByocToken(phone);
  if (!token) {
    const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://lastbite.fun";
    await sendWhatsApp(
      phone,
      `Connect your Swiggy MCP first: ${site}/connect — paste your Claude Desktop bearer token there, then come back.`,
    );
    return NextResponse.json({ ok: true, needsConnect: true });
  }

  const swiggy = new SwiggyClient({ token });
  try {
    const { reply } = await processTurn({ userId: phone, text, swiggy });
    if (reply) await sendWhatsApp(phone, reply);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UserBusyError) {
      await sendWhatsApp(phone, "Still working on your previous message — give me a few seconds.");
      return NextResponse.json({ ok: true, busy: true });
    }
    safeLog("whatsapp.error", { message: (err as Error).message });
    await sendWhatsApp(phone, "Something broke on my end. Try again in a minute.");
    return NextResponse.json({ ok: false }, { status: 500 });
  } finally {
    await swiggy.close();
  }
}

export async function GET() {
  return NextResponse.json({
    name: "Last Bite WhatsApp webhook",
    poweredBy: "Swiggy",
  });
}
