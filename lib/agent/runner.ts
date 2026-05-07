import { Command } from "@langchain/langgraph";
import { compileLastBite, type LastBiteStateT, type RunStatus } from "@/lib/agent/graph";
import { InterruptPayload, classifyReply, type InterruptPayload as InterruptPayloadT } from "@/lib/agent/schemas";
import type { SwiggyClient } from "@/lib/mcp/swiggy-client";
import {
  acquireUserLock,
  bumpLastActiveAt,
  getLastActiveAt,
  releaseUserLock,
} from "@/lib/redis";
import { safeLog } from "@/lib/redact";

/**
 * Pending gates older than this auto-clear so the user's next message
 * starts a fresh order instead of being treated as a stale yes/no.
 */
const ABANDON_THRESHOLD_MS = 30 * 60 * 1000;

/** Thrown when a concurrent inbound is already in flight for the same user. */
export class UserBusyError extends Error {
  readonly userId: string;
  constructor(userId: string) {
    super(`Another inbound for ${userId} is still being processed`);
    this.userId = userId;
    this.name = "UserBusyError";
  }
}

export interface RunnerInput {
  userId: string;
  text: string;
  swiggy: SwiggyClient;
}

export interface RunnerReply {
  reply: string | null;
  status: RunStatus;
  orderId: string | null;
  paused: boolean;
}

export async function processTurn({ userId, text, swiggy }: RunnerInput): Promise<RunnerReply> {
  const lockToken = await acquireUserLock(userId);
  if (!lockToken) throw new UserBusyError(userId);
  try {
    return await runTurn({ userId, text, swiggy });
  } finally {
    await releaseUserLock(userId, lockToken);
  }
}

async function runTurn({ userId, text, swiggy }: RunnerInput): Promise<RunnerReply> {
  const graph = await compileLastBite(swiggy);
  const config = { configurable: { thread_id: userId } };

  const before = await graph.getState(config);
  let beforePending = pickPendingInterrupt(before?.tasks ?? []);
  let hasPendingInterrupt = beforePending !== null;

  // Abandoned-thread guard: if there's a stale gate and the user's last
  // activity was > 30 minutes ago (or last:* expired entirely), force-close
  // the prior run with STOP and treat this turn as a fresh query.
  if (hasPendingInterrupt) {
    const lastActive = await getLastActiveAt(userId);
    const idleMs = lastActive === 0 ? Infinity : Date.now() - lastActive;
    if (idleMs > ABANDON_THRESHOLD_MS) {
      safeLog("agent.runner.abandoned-cleared", { userId, idleMs });
      await graph.invoke(new Command({ resume: "STOP" }), config);
      beforePending = null;
      hasPendingInterrupt = false;
    }
  }

  // If we're paused at a gate and the user replied unclearly (not yes/stop),
  // re-prompt without advancing the graph. Saves them from accidental
  // cancellations and keeps the gate state intact.
  if (
    hasPendingInterrupt &&
    beforePending !== null &&
    (beforePending.kind === "gate" || beforePending.kind === "final-gate") &&
    classifyReply(text) === "unclear"
  ) {
    const beforeValues = (before?.values ?? {}) as Partial<LastBiteStateT>;
    await bumpLastActiveAt(userId);
    return {
      reply: `I didn't catch that. Reply YES to continue or STOP to cancel.\n\n${beforePending.text}`,
      status: (beforeValues.status as RunStatus | undefined) ?? "in-progress",
      orderId: beforeValues.orderId ?? null,
      paused: true,
    };
  }

  if (hasPendingInterrupt) {
    await graph.invoke(new Command({ resume: text }), config);
  } else {
    const init: Partial<LastBiteStateT> = {
      userId,
      query: text,
      gatesPassed: {},
      cart: null,
      orderId: null,
      status: "in-progress",
    };
    await graph.invoke(init as LastBiteStateT, config);
  }
  await bumpLastActiveAt(userId);

  const after = await graph.getState(config);
  if (!after) {
    return { reply: null, status: "failed", orderId: null, paused: false };
  }
  const values = after.values as LastBiteStateT;
  const pendingInterrupt = pickPendingInterrupt(after.tasks ?? []);

  if (pendingInterrupt) {
    return {
      reply: pendingInterrupt.text,
      status: values.status,
      orderId: values.orderId,
      paused: true,
    };
  }

  return {
    reply: terminalReply(values),
    status: values.status,
    orderId: values.orderId,
    paused: false,
  };
}

interface TaskLike {
  interrupts?: Array<{ value?: unknown }>;
}

function pickPendingInterrupt(tasks: TaskLike[]): InterruptPayloadT | null {
  for (const task of tasks) {
    const interrupts = task.interrupts ?? [];
    for (let i = interrupts.length - 1; i >= 0; i--) {
      const parsed = InterruptPayload.safeParse(interrupts[i].value);
      if (parsed.success) return parsed.data;
    }
  }
  return null;
}

function terminalReply(state: LastBiteStateT): string {
  switch (state.status) {
    case "placed":
      return `Order placed. ID: ${state.orderId ?? "unknown"}.\nPowered by Swiggy.`;
    case "cancelled":
      return `Cancelled. No order placed.\nPowered by Swiggy.`;
    case "duplicate":
      return `Looks like you already placed this earlier today. No duplicate sent.\nPowered by Swiggy.`;
    case "failed": {
      const reason =
        state.failureReason ?? `Couldn't build a cart from that. Try: "biryani from Paradise, ₹500".`;
      return `${reason}\nPowered by Swiggy.`;
    }
    default:
      return `Working on it.\nPowered by Swiggy.`;
  }
}
