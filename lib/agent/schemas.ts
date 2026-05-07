import { z } from "zod";

export const CartItem = z.object({
  itemId: z.string(),
  name: z.string(),
  qty: z.number().int().positive(),
  priceRupees: z.number().nonnegative(),
  caloriesKcal: z.number().nonnegative().optional(),
});
export type CartItem = z.infer<typeof CartItem>;

export const Cart = z.object({
  restaurantId: z.string(),
  restaurantName: z.string(),
  items: z.array(CartItem).min(1),
  subtotalRupees: z.number().nonnegative(),
  deliveryRupees: z.number().nonnegative().default(0),
  totalRupees: z.number().nonnegative(),
  etaMin: z.number().int().nonnegative().optional(),
});
export type Cart = z.infer<typeof Cart>;

export const GatesPassed = z.object({
  calorie: z.boolean().optional(),
  eta: z.boolean().optional(),
  final: z.boolean().optional(),
});
export type GatesPassed = z.infer<typeof GatesPassed>;

export const InterruptPayload = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("cart-ready"),
    text: z.string(),
    cart: Cart,
  }),
  z.object({
    kind: z.literal("gate"),
    stage: z.enum(["calorie", "eta"]),
    text: z.string(),
  }),
  z.object({
    kind: z.literal("final-gate"),
    stage: z.literal("final"),
    text: z.string(),
    graceSeconds: z.number().int().positive(),
  }),
]);
export type InterruptPayload = z.infer<typeof InterruptPayload>;

const STOP_TOKENS = ["stop", "no", "n", "cancel", "abort", "nahi", "nahin", "ruko", "band karo"];
const YES_TOKENS = ["yes", "y", "ok", "okay", "go", "haan", "haan ji", "ji", "confirm", "✅"];

export function classifyReply(text: string): "yes" | "stop" | "unclear" {
  const t = text.trim().toLowerCase();
  if (!t) return "unclear";
  if (STOP_TOKENS.some((tok) => t === tok || t.startsWith(`${tok} `))) return "stop";
  if (YES_TOKENS.some((tok) => t === tok || t.startsWith(`${tok} `))) return "yes";
  return "unclear";
}
