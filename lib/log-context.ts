import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";

export interface LogContext {
  requestId: string;
  userId?: string;
}

const storage = new AsyncLocalStorage<LogContext>();

/** Run `fn` with a request-scoped log context that prefixes every safeLog. */
export function withLogContext<T>(ctx: LogContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

/** Read the current log context, if any. */
export function logContext(): LogContext | undefined {
  return storage.getStore();
}

/** 8-char hex id for log correlation. */
export function newRequestId(): string {
  return randomBytes(4).toString("hex");
}
