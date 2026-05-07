import { NextResponse } from "next/server";
import {
  callbackUri,
  exchangeAuthorizationCode,
  openState,
  readStateCookie,
  registerClient,
  siteUrl,
  stateCookieHeaders,
} from "@/lib/swiggy-oauth";
import { setByocToken } from "@/lib/byoc";
import { sealSession, setSessionCookie } from "@/lib/session";
import { newRequestId, withLogContext } from "@/lib/log-context";
import { safeLog } from "@/lib/redact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return withLogContext({ requestId: newRequestId() }, () => handle(req));
}

function bounce(reason: string): NextResponse {
  const url = `${siteUrl()}/connect?error=${encodeURIComponent(reason)}`;
  const res = NextResponse.redirect(url, 303);
  // Always clear the state cookie on bounce.
  for (const [k, v] of Object.entries(stateCookieHeaders("", "clear"))) {
    res.headers.set(k, v);
  }
  return res;
}

async function handle(req: Request) {
  const url = new URL(req.url);
  const swiggyError = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const stateNonce = url.searchParams.get("state");

  if (swiggyError) {
    safeLog("oauth.callback.swiggy-error", { error: swiggyError });
    return bounce(`swiggy_${swiggyError}`);
  }
  if (!code || !stateNonce) {
    return bounce("missing_code_or_state");
  }

  const sealed = readStateCookie(req.headers.get("cookie"));
  if (!sealed) {
    return bounce("missing_cookie");
  }

  let opened;
  try {
    opened = openState(sealed);
  } catch (err) {
    safeLog("oauth.callback.state-bad", { message: (err as Error).message });
    return bounce("state_invalid");
  }
  if (opened.nonce !== stateNonce) {
    return bounce("state_mismatch");
  }

  const redirectUri = callbackUri();
  let clientId: string;
  try {
    clientId = await registerClient(redirectUri);
  } catch {
    return bounce("register_failed");
  }

  let tokens;
  try {
    tokens = await exchangeAuthorizationCode({
      clientId,
      redirectUri,
      code,
      verifier: opened.verifier,
    });
  } catch (err) {
    safeLog("oauth.callback.exchange-failed", { message: (err as Error).message });
    return bounce("exchange_failed");
  }

  try {
    await setByocToken(opened.phone, tokens.access_token);
  } catch (err) {
    safeLog("oauth.callback.persist-failed", { message: (err as Error).message });
    return bounce("storage_failed");
  }

  safeLog("oauth.callback.ok", { phone: opened.phone });

  const successUrl = `${siteUrl()}/connect/success?phone=${encodeURIComponent(opened.phone)}`;
  const res = NextResponse.redirect(successUrl, 303);
  // Clear OAuth state cookie + issue auth session cookie.
  for (const [k, v] of Object.entries(stateCookieHeaders("", "clear"))) {
    res.headers.set(k, v);
  }
  for (const [k, v] of Object.entries(setSessionCookie(sealSession(opened.phone), "set"))) {
    res.headers.append(k, v);
  }
  return res;
}
