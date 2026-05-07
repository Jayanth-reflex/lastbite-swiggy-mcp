/**
 * End-to-end probe against PRODUCTION /api/admin/run-turn:
 *   query → calorie gate → ETA gate → final-gate
 * Stops BEFORE final YES, then sends STOP to leave thread cancelled.
 *
 *   npm run live-e2e               # default query
 *   npm run live-e2e -- "biryani Paradise ₹500"
 */

import { promises as fs } from "node:fs";
import path from "node:path";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://swiggy-mcp.vercel.app";

interface RunnerReply {
  reply: string | null;
  status: "in-progress" | "cancelled" | "placed" | "duplicate" | "failed";
  orderId: string | null;
  paused: boolean;
}

async function readSecret(): Promise<string> {
  const raw = await fs.readFile(path.join(process.cwd(), ".admin-secret.local"), "utf8");
  return raw.trim();
}

async function findRegisteredPhone(secret: string): Promise<string> {
  // Cheap reachability probe: hit a known route to confirm prod is up.
  const ping = await fetch(`${SITE}/api/whatsapp`).then((r) => r.json()).catch(() => null);
  if (!ping || ping.poweredBy !== "Swiggy") {
    throw new Error(`prod not reachable: ${SITE}`);
  }
  // We need a registered phone. Try the one we saw earlier.
  // The user's e164 ends in 2869 per Swiggy's masked phoneNumber.
  // Read from a previously-saved local hint if available.
  const hintFile = path.join(process.cwd(), ".registered-phone.local");
  try {
    const v = (await fs.readFile(hintFile, "utf8")).trim();
    if (v) return v;
  } catch {
    /* fall through */
  }
  // Fallback: try the admin probe with the known phone
  void secret;
  return "+916304362869";
}

async function runTurn(secret: string, phone: string, text: string): Promise<RunnerReply> {
  const res = await fetch(`${SITE}/api/admin/run-turn`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ phone, text }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 240)}`);
  }
  return (await res.json()) as RunnerReply;
}

async function main() {
  const QUERY =
    process.argv.slice(2).filter((a) => !a.startsWith("--")).join(" ") ||
    "chicken biryani from Paradise, ₹500 budget";

  console.log("\n=== Live e2e via /api/admin/run-turn (prod) ===\n");
  const secret = await readSecret();
  const phone = await findRegisteredPhone(secret);
  console.log(`✓ targeting ${SITE}, phone=${maskPhone(phone)}\n`);

  console.log(`> ${JSON.stringify(QUERY)}`);
  console.log("  (real Swiggy MCP via Groq LLM searcher; ~5-15s)\n");
  const t0 = Date.now();
  const turn1 = await runTurn(secret, phone, QUERY);
  console.log(`< [${Date.now() - t0}ms] status=${turn1.status} paused=${turn1.paused}`);
  console.log(`  reply: ${turn1.reply}\n`);

  if (turn1.status === "failed") {
    console.log("✗ Searcher failed to build a cart. The reply above explains why.");
    return;
  }

  const calorieReached = turn1.paused && (turn1.reply?.toLowerCase().includes("kcal") ?? false);
  if (!calorieReached) {
    console.log("(unexpected: did not reach calorie gate; aborting)");
    return;
  }

  console.log(`> "yes"`);
  const turn2 = await runTurn(secret, phone, "yes");
  console.log(`< status=${turn2.status} paused=${turn2.paused}`);
  console.log(`  reply: ${turn2.reply}\n`);

  if (turn2.status !== "in-progress") return;

  console.log(`> "yes"`);
  const turn3 = await runTurn(secret, phone, "yes");
  console.log(`< status=${turn3.status} paused=${turn3.paused}`);
  console.log(`  reply: ${turn3.reply}\n`);

  if (turn3.paused && turn3.reply?.toLowerCase().includes("final")) {
    console.log("=========================================================");
    console.log("✓ Reached final gate. STOPPING BEFORE the final YES.");
    console.log("=========================================================\n");

    // Reset thread cleanly so the user's next interaction starts fresh.
    console.log(`→ sending "STOP" to clear thread state…`);
    const turnStop = await runTurn(secret, phone, "STOP");
    console.log(`< status=${turnStop.status} reply=${turnStop.reply}\n`);
  }

  console.log("=== Done. Your call on whether to commit. ===\n");
}

function maskPhone(p: string): string {
  const digits = p.replace(/\D/g, "");
  if (digits.length <= 4) return p;
  return `${p.slice(0, p.length - digits.length + 2)}…${digits.slice(-4)}`;
}

main().catch((err) => {
  console.error("\n✗ Live e2e crashed:", err.message ?? err);
  process.exit(2);
});
