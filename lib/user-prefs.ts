import { redis } from "@/lib/redis";

export type OrderMode = "demo" | "live";

const TTL_SECONDS = 60 * 60 * 24 * 365; // 1 year

/** Whether the deployment globally allows real orders. Kill-switch. */
export function realOrdersGloballyEnabled(): boolean {
  return process.env.LB_REAL_ORDERS === "1";
}

/** Read user's preferred order mode. Defaults to "demo" if unset. */
export async function getUserMode(phone: string): Promise<OrderMode> {
  const v = (await redis().get<string>(`mode:${phone}`)) ?? "demo";
  return v === "live" ? "live" : "demo";
}

export async function setUserMode(phone: string, mode: OrderMode): Promise<void> {
  await redis().set(`mode:${phone}`, mode, { ex: TTL_SECONDS });
}

/**
 * Effective mode used by the placer. The global kill switch always wins:
 * if LB_REAL_ORDERS is not set on the server, every user is forced into
 * demo regardless of their preference.
 */
export async function effectiveMode(phone: string): Promise<OrderMode> {
  if (!realOrdersGloballyEnabled()) return "demo";
  return getUserMode(phone);
}
