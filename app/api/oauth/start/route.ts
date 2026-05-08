import { NextResponse } from "next/server";
import { z } from "zod";
import {
  buildAuthorizationUrl,
  callbackUri,
  makePkce,
  makeState,
  registerClient,
  stateCookieHeaders,
} from "@/lib/swiggy-oauth";
import { normalisePhone } from "@/lib/byoc";
import { clientIp, connectLimiter } from "@/lib/ratelimit";
import { newRequestId, withLogContext } from "@/lib/log-context";
import { safeLog } from "@/lib/redact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  phone: z.string().regex(/^\+?\d{10,15}$/, "Phone must be 10–15 digits"),
  inviteCode: z.string().optional(),
});

export async function POST(req: Request) {
  return withLogContext({ requestId: newRequestId() }, () => handle(req));
}

async function handle(req: Request) {
  const limiter = connectLimiter();
  if (limiter) {
    const ip = clientIp(req);
    const { success, reset } = await limiter.limit(`ip:${ip}`);
    if (!success) {
      const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
      return NextResponse.json(
        { error: "Too many attempts. Try again in a few minutes." },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }
  }

  const raw = await req.json().catch((err) => {
    safeLog("oauth.start.json-parse-failed", { message: (err as Error).message });
    return null;
  });
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  const expectedInvite = process.env.CONNECT_INVITE_CODE;
  if (expectedInvite && parsed.data.inviteCode !== expectedInvite) {
    return NextResponse.json({ error: "Invalid invite code." }, { status: 403 });
  }

  const phone = normalisePhone(parsed.data.phone);
  const redirectUri = callbackUri();

  let clientId: string;
  try {
    clientId = await registerClient(redirectUri);
  } catch (err) {
    safeLog("oauth.start.register-failed", { message: (err as Error).message });
    return NextResponse.json(
      { error: "Couldn't reach Swiggy auth right now. Please try again in a minute." },
      { status: 502 },
    );
  }

  const { verifier, challenge } = makePkce();
  const { sealed, nonce } = makeState(phone, verifier);

  const url = buildAuthorizationUrl({
    clientId,
    redirectUri,
    state: nonce,
    challenge,
  });

  safeLog("oauth.start", { phone, redirectUri });

  return NextResponse.json(
    { redirectUrl: url },
    { headers: stateCookieHeaders(sealed, "set") },
  );
}
