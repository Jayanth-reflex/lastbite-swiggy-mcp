import { safeLog } from "@/lib/redact";

const GUPSHUP_API = "https://api.gupshup.io/wa/api/v1/msg";

export interface GupshupOptions {
  apiKey: string;
  appName: string;
  source: string;
}

function fromEnv(): GupshupOptions | null {
  const apiKey = process.env.GUPSHUP_API_KEY;
  const appName = process.env.GUPSHUP_APP_NAME;
  const source = process.env.GUPSHUP_SOURCE_PHONE;
  if (!apiKey || !appName || !source) return null;
  return { apiKey, appName, source };
}

export async function sendWhatsApp(toPhoneE164: string, body: string): Promise<void> {
  const opts = fromEnv();
  const text = ensurePoweredBy(body);
  if (!opts) {
    safeLog("whatsapp.dryrun", { to: toPhoneE164, body: text });
    return;
  }
  const params = new URLSearchParams({
    channel: "whatsapp",
    source: opts.source,
    destination: toPhoneE164,
    "src.name": opts.appName,
    message: JSON.stringify({ type: "text", text }),
  });
  const res = await fetch(GUPSHUP_API, {
    method: "POST",
    headers: {
      apikey: opts.apiKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  if (!res.ok) {
    const errText = await res.text();
    safeLog("whatsapp.error", { status: res.status, body: errText });
    throw new Error(`Gupshup send failed: ${res.status}`);
  }
}

function ensurePoweredBy(body: string): string {
  return body.toLowerCase().includes("powered by swiggy") ? body : `${body}\n\nPowered by Swiggy.`;
}

interface GupshupInbound {
  type: string;
  app: string;
  payload?: {
    id?: string;
    type?: string;
    payload?: { text?: string };
    sender?: { phone?: string };
  };
}

export interface InboundMessage {
  fromPhone: string;
  text: string;
  /** Gupshup-issued message id; used for webhook dedup. */
  messageId: string | null;
}

export function parseInbound(raw: unknown): InboundMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as GupshupInbound;
  if (body.type !== "message") return null;
  const text = body.payload?.payload?.text;
  const phone = body.payload?.sender?.phone;
  if (!text || !phone) return null;
  return { fromPhone: phone, text, messageId: body.payload?.id ?? null };
}
