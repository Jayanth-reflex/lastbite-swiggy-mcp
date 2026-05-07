import { MemorySaver, type BaseCheckpointSaver } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { Pool } from "pg";

let cached: BaseCheckpointSaver | null = null;
let setupPromise: Promise<void> | null = null;
let pool: Pool | null = null;

/**
 * Production checkpointer: PostgresSaver when LASTBITE_PG_URL is set,
 * MemorySaver otherwise (dev / smoke only — does not survive cold starts).
 *
 * Uses a pg.Pool capped at LASTBITE_PG_POOL_MAX (default 2) so each
 * Vercel lambda doesn't burn through the upstream connection budget under
 * Fluid Compute concurrency. `setup()` runs once per process; safe to
 * call from multiple concurrent invocations within the same instance.
 */
export async function getCheckpointer(): Promise<BaseCheckpointSaver> {
  if (cached) return cached;
  const url = process.env.LASTBITE_PG_URL;
  if (!url) {
    cached = new MemorySaver();
    return cached;
  }
  if (!pool) {
    const max = Number(process.env.LASTBITE_PG_POOL_MAX) || 2;
    pool = new Pool({
      connectionString: url,
      max,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  const saver = new PostgresSaver(pool);
  if (!setupPromise) setupPromise = saver.setup();
  await setupPromise;
  cached = saver as unknown as BaseCheckpointSaver;
  return cached;
}
