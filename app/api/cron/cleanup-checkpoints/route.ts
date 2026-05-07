import { NextResponse } from "next/server";
import { Pool } from "pg";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { getLastActiveAt } from "@/lib/redis";
import { safeLog } from "@/lib/redact";
import { newRequestId, withLogContext } from "@/lib/log-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

function verifyCron(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return req.headers.get("authorization") === `Bearer ${expected}`;
}

/**
 * Daily job (Vercel Cron) that drops graph state for threads whose
 * last:* heartbeat is older than 7 days. Threads with no last:* key are
 * skipped — `bumpLastActiveAt`'s 30-day TTL means absence implies the
 * user has been gone for at least a month, which is fine to keep until
 * the next run; absent keys also include freshly-created threads that
 * haven't yet completed a turn, and we MUST NOT race-delete those.
 */
export async function GET(req: Request) {
  return withLogContext({ requestId: newRequestId() }, () => handle(req));
}

async function handle(req: Request) {
  if (!verifyCron(req)) {
    return new NextResponse("forbidden", { status: 403 });
  }

  const url = process.env.LASTBITE_PG_URL;
  if (!url) {
    return NextResponse.json({ ok: true, skipped: "no LASTBITE_PG_URL" });
  }

  const pool = new Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  const saver = new PostgresSaver(pool);

  let total = 0;
  let deleted = 0;
  let skippedNoHeartbeat = 0;

  try {
    const { rows } = await pool.query<{ thread_id: string }>(
      "SELECT DISTINCT thread_id FROM checkpoints",
    );
    total = rows.length;

    const now = Date.now();
    for (const { thread_id } of rows) {
      const lastActive = await getLastActiveAt(thread_id);
      if (lastActive === 0) {
        skippedNoHeartbeat++;
        continue;
      }
      if (now - lastActive > STALE_THRESHOLD_MS) {
        await saver.deleteThread(thread_id);
        deleted++;
        safeLog("cron.cleanup.deleted", { threadId: thread_id, idleMs: now - lastActive });
      }
    }
  } finally {
    await pool.end();
  }

  safeLog("cron.cleanup.done", { total, deleted, skippedNoHeartbeat });
  return NextResponse.json({ ok: true, total, deleted, skippedNoHeartbeat });
}
