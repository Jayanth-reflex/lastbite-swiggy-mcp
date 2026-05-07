import type { Cart, CartItem } from "@/lib/agent/schemas";

interface SwiggyItem {
  menu_item_id?: string | number;
  item_id?: string | number;
  itemId?: string | number;
  id?: string | number;
  name?: string;
  title?: string;
  quantity?: number;
  qty?: number;
  final_price?: number;
  total?: number;
  subtotal?: number;
  price?: number;
  priceRupees?: number;
  caloriesKcal?: number;
  calories?: number;
  kcal?: number;
}

interface SwiggyPricing {
  item_total?: number;
  subtotal?: number;
  delivery_charge?: number;
  delivery_fee?: number;
  to_pay?: number;
  total?: number;
  grand_total?: number;
  taxes_and_charges?: number;
}

interface SwiggyCartShape {
  cart_id?: string | number;
  restaurant?: { id?: string | number; name?: string; deliverySubtitle?: string };
  restaurantId?: string;
  restaurant_id?: string;
  restaurantName?: string;
  restaurant_name?: string;
  items?: SwiggyItem[];
  line_items?: SwiggyItem[];
  pricing?: SwiggyPricing;
  subtotalRupees?: number;
  subtotal?: number;
  deliveryRupees?: number;
  totalRupees?: number;
  total?: number;
  etaMin?: number;
  eta_min?: number;
  eta?: number;
}

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0
    ? v
    : typeof v === "number"
      ? String(v)
      : undefined;

function pickItem(raw: SwiggyItem): CartItem | null {
  const itemId = str(raw.menu_item_id) ?? str(raw.item_id) ?? str(raw.itemId) ?? str(raw.id);
  const name = str(raw.name) ?? str(raw.title);
  const qty = num(raw.quantity) ?? num(raw.qty) ?? 1;
  const price = num(raw.final_price) ?? num(raw.priceRupees) ?? num(raw.price) ?? num(raw.total) ?? num(raw.subtotal);
  if (!itemId || !name || price === undefined) return null;
  const kcal = num(raw.caloriesKcal) ?? num(raw.calories) ?? num(raw.kcal);
  return { itemId, name, qty, priceRupees: price, caloriesKcal: kcal };
}

function parseEtaFromSubtitle(s?: string): number | undefined {
  if (!s) return undefined;
  const m = s.match(/(\d+)\s*(?:-\s*(\d+))?\s*mins?/i);
  if (!m) return undefined;
  const lo = Number(m[1]);
  const hi = m[2] ? Number(m[2]) : lo;
  return Number.isFinite(lo) && Number.isFinite(hi) ? Math.round((lo + hi) / 2) : undefined;
}

export interface TryParseCartOptions {
  /** Hint passed by coerceToCart from upstream tool-call args (restaurantId). */
  restaurantIdHint?: string;
  restaurantNameHint?: string;
}

/**
 * Permissively coerce arbitrary Swiggy cart-shaped JSON into our internal
 * Cart type. The real `get_food_cart` MCP response (after our SwiggyClient
 * unwrap) has the shape:
 *   { statusCode, statusMessage, data: { items, pricing, restaurant }, availablePaymentMethods }
 * — `data: null` when empty, populated object otherwise.
 *
 * The cart payload itself does not include `restaurant.id`; pass it via
 * `opts.restaurantIdHint` (typically extracted from the most recent
 * search_restaurants / update_food_cart tool call).
 */
export function tryParseCart(raw: unknown, opts?: TryParseCartOptions): Cart | null {
  if (!raw || typeof raw !== "object") return null;
  const top = raw as Record<string, unknown>;
  const inner = top.data && typeof top.data === "object" ? (top.data as Record<string, unknown>) : null;
  const r = (inner ?? top) as SwiggyCartShape;

  const items = (r.items ?? r.line_items ?? []).map(pickItem).filter((i): i is CartItem => i !== null);
  if (items.length === 0) return null;

  const restaurantName =
    str(r.restaurant?.name) ?? str(r.restaurantName) ?? str(r.restaurant_name) ?? opts?.restaurantNameHint;
  const restaurantId =
    str(r.restaurant?.id) ?? str(r.restaurantId) ?? str(r.restaurant_id) ?? opts?.restaurantIdHint;
  if (!restaurantId || !restaurantName) return null;

  const subtotal =
    num(r.pricing?.item_total) ??
    num(r.pricing?.subtotal) ??
    num(r.subtotalRupees) ??
    num(r.subtotal) ??
    items.reduce((s, i) => s + i.priceRupees * i.qty, 0);
  const delivery = num(r.pricing?.delivery_charge) ?? num(r.pricing?.delivery_fee) ?? num(r.deliveryRupees) ?? 0;
  const total =
    num(r.pricing?.to_pay) ??
    num(r.pricing?.total) ??
    num(r.pricing?.grand_total) ??
    num(r.totalRupees) ??
    num(r.total) ??
    Math.round(subtotal + delivery + (num(r.pricing?.taxes_and_charges) ?? 0));
  const eta = num(r.etaMin) ?? num(r.eta_min) ?? num(r.eta) ?? parseEtaFromSubtitle(r.restaurant?.deliverySubtitle);

  return {
    restaurantId,
    restaurantName,
    items,
    subtotalRupees: subtotal,
    deliveryRupees: delivery,
    totalRupees: total,
    etaMin: eta,
  };
}

