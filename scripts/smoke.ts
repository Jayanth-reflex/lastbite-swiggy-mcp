/**
 * End-to-end smoke test for Last Bite — runs the full graph with fixtures,
 * an in-memory Redis shim, and no LLM calls. Exits non-zero on any
 * deviation from the expected gate sequence.
 *
 *   npm run smoke
 */

process.env.LASTBITE_OFFLINE = "1";
process.env.USE_FIXTURES = "1";
process.env.SKIP_PERSONA = "1";
process.env.LASTBITE_GRACE_SECONDS = process.env.LASTBITE_GRACE_SECONDS ?? "1";
process.env.BYOC_DEV_TOKEN = process.env.BYOC_DEV_TOKEN ?? "smoke-fixture-token";
process.env.BYOC_ENCRYPTION_KEY =
  process.env.BYOC_ENCRYPTION_KEY ??
  "smoke-aes-256-key-not-for-production-use-only-32+chars";

import { processTurn, UserBusyError } from "@/lib/agent/runner";
import { SwiggyClient } from "@/lib/mcp/swiggy-client";
import { bumpLastActiveAt, cancelGrace, isGraceActive } from "@/lib/redis";

interface Expectation {
  send: string;
  expectStatus: "in-progress" | "placed" | "cancelled" | "duplicate" | "failed";
  expectPaused: boolean;
  expectReplyContains: string;
  label: string;
}

const userId = "+919876500001";
const swiggy = new SwiggyClient({ token: "smoke-fixture-token" });

const happyPath: Expectation[] = [
  {
    label: "1) initial query → calorie gate",
    send: "biryani Paradise ₹500",
    expectStatus: "in-progress",
    expectPaused: true,
    expectReplyContains: "kcal",
  },
  {
    label: "2) calorie YES → ETA gate",
    send: "yes",
    expectStatus: "in-progress",
    expectPaused: true,
    expectReplyContains: "ETA",
  },
  {
    label: "3) ETA YES → final gate",
    send: "haan",
    expectStatus: "in-progress",
    expectPaused: true,
    expectReplyContains: "Final gate",
  },
  {
    label: "4) final YES → grace timer fires → order placed",
    send: "yes",
    expectStatus: "placed",
    expectPaused: false,
    expectReplyContains: "Order placed",
  },
];

let failures = 0;
function check(label: string, ok: boolean, detail: string) {
  if (ok) {
    console.log(`✓ ${label} — ${detail}`);
  } else {
    console.error(`✗ ${label} — ${detail}`);
    failures++;
  }
}

async function runHappyPath() {
  console.log("\n=== Happy path (offline, fixtures, 1s grace) ===\n");
  for (const step of happyPath) {
    const result = await processTurn({ userId, text: step.send, swiggy });
    const ok =
      result.status === step.expectStatus &&
      result.paused === step.expectPaused &&
      typeof result.reply === "string" &&
      result.reply.toLowerCase().includes(step.expectReplyContains.toLowerCase());
    check(
      step.label,
      ok,
      `sent="${step.send}" → status=${result.status} paused=${result.paused} reply=${JSON.stringify(result.reply)}`,
    );
  }
}

async function runStopDuringGracePath() {
  console.log("\n=== STOP-during-grace path ===\n");
  const otherUser = "+919876500002";
  await processTurn({ userId: otherUser, text: "biryani ₹500", swiggy });
  await processTurn({ userId: otherUser, text: "yes", swiggy });
  await processTurn({ userId: otherUser, text: "yes", swiggy });

  // We're now at the final-gate interrupt for otherUser. Resume with YES then
  // immediately cancel via the webhook-style path before the grace timer
  // commits. This races: we cancel before processTurn's awaitGrace returns.
  process.env.LASTBITE_GRACE_SECONDS = "3";
  const racePromise = processTurn({ userId: otherUser, text: "yes", swiggy });
  await new Promise((r) => setTimeout(r, 300));
  const active = await isGraceActive(otherUser);
  check("grace flag is active during 3s window", active, `isGraceActive(${otherUser}) = ${active}`);
  await cancelGrace(otherUser);
  const result = await racePromise;
  check(
    "STOP during grace cancels the order",
    result.status === "cancelled" && result.reply?.toLowerCase().includes("cancelled") === true,
    `status=${result.status} reply=${JSON.stringify(result.reply)}`,
  );
  process.env.LASTBITE_GRACE_SECONDS = "1";
}

async function runIdempotencyPath() {
  console.log("\n=== Idempotency path (same user, same cart, same day) ===\n");
  const dupUser = "+919876500003";
  for (const text of ["biryani ₹500", "yes", "yes", "yes"]) {
    await processTurn({ userId: dupUser, text, swiggy });
  }
  let last: Awaited<ReturnType<typeof processTurn>> | null = null;
  for (const text of ["biryani ₹500", "yes", "yes", "yes"]) {
    last = await processTurn({ userId: dupUser, text, swiggy });
  }
  check(
    "second identical order returns duplicate",
    last?.status === "duplicate",
    `status=${last?.status} reply=${JSON.stringify(last?.reply)}`,
  );
}

async function runUnclearReplyPath() {
  console.log("\n=== Unclear reply re-prompts at the calorie gate ===\n");
  const user = "+919876500004";
  const initial = await processTurn({ userId: user, text: "biryani ₹500", swiggy });
  check(
    "initial query lands at calorie gate",
    initial.paused && initial.reply?.includes("kcal") === true,
    `paused=${initial.paused} reply=${JSON.stringify(initial.reply)}`,
  );

  const unclear = await processTurn({ userId: user, text: "what about pizza tomorrow?", swiggy });
  check(
    "unclear reply re-prompts and stays paused",
    unclear.paused &&
      unclear.status === "in-progress" &&
      unclear.reply?.toLowerCase().includes("didn't catch") === true,
    `paused=${unclear.paused} status=${unclear.status} reply=${JSON.stringify(unclear.reply)}`,
  );

  const yes = await processTurn({ userId: user, text: "yes", swiggy });
  check(
    "after unclear, YES still advances to ETA gate",
    yes.paused && yes.reply?.includes("ETA") === true,
    `paused=${yes.paused} reply=${JSON.stringify(yes.reply)}`,
  );
}

async function runStateLeakRegressionPath() {
  console.log("\n=== Regression: gates do NOT leak from a placed run into the next ===\n");
  const user = "+919876500005";
  // Run 1: full happy path → places order
  for (const text of ["biryani ₹500", "yes", "yes", "yes"]) {
    await processTurn({ userId: user, text, swiggy });
  }
  // Run 2 turn 1: must hit calorie gate, NOT skip to final-gate or placer
  const fresh = await processTurn({ userId: user, text: "biryani again", swiggy });
  check(
    "first prompt of new run is the calorie gate (not final)",
    fresh.paused &&
      fresh.reply?.toLowerCase().includes("kcal") === true &&
      fresh.reply?.toLowerCase().includes("final") !== true,
    `paused=${fresh.paused} reply=${JSON.stringify(fresh.reply)}`,
  );
}

async function runAbandonedTimeoutPath() {
  console.log("\n=== Abandoned-thread timeout: stale gate auto-clears ===\n");
  const user = "+919876500006";
  const initial = await processTurn({ userId: user, text: "biryani ₹500", swiggy });
  check(
    "initial run lands at calorie gate",
    initial.paused && initial.reply?.includes("kcal") === true,
    `paused=${initial.paused}`,
  );

  await bumpLastActiveAt(user, Date.now() - 31 * 60 * 1000);

  const fresh = await processTurn({ userId: user, text: "pizza domino's ₹400", swiggy });
  check(
    "stale gate auto-cleared, new query starts a fresh order",
    fresh.paused &&
      fresh.reply?.toLowerCase().includes("kcal") === true &&
      fresh.reply?.toLowerCase().includes("didn't catch") !== true,
    `paused=${fresh.paused} reply=${JSON.stringify(fresh.reply)}`,
  );
}

async function runConcurrentLockPath() {
  console.log("\n=== Per-user mutex: concurrent inbound rejected ===\n");
  const user = "+919876500007";

  const [a, b] = await Promise.allSettled([
    processTurn({ userId: user, text: "biryani ₹500", swiggy }),
    processTurn({ userId: user, text: "pizza ₹400", swiggy }),
  ]);

  const settled = [a, b];
  const succeededCount = settled.filter((r) => r.status === "fulfilled").length;
  const failures = settled.flatMap((r) => (r.status === "rejected" ? [r.reason] : []));
  const isUserBusy = failures.length === 1 && failures[0] instanceof UserBusyError;

  check(
    "concurrent inbound: 1 succeeds, 1 raises UserBusyError",
    succeededCount === 1 && isUserBusy,
    `succeeded=${succeededCount} failed=${failures.length} firstReason=${
      (failures[0] as Error | undefined)?.message ?? "n/a"
    }`,
  );
}

async function main() {
  await runHappyPath();
  await runStopDuringGracePath();
  await runIdempotencyPath();
  await runUnclearReplyPath();
  await runStateLeakRegressionPath();
  await runAbandonedTimeoutPath();
  await runConcurrentLockPath();
  await swiggy.close();

  console.log(`\n=== Result: ${failures === 0 ? "PASS" : `FAIL (${failures} failed)`} ===\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("smoke crashed:", err);
  process.exit(2);
});
