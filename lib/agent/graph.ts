import {
  Annotation,
  Command,
  END,
  START,
  StateGraph,
  interrupt,
} from "@langchain/langgraph";
import { parseIntent, type Intent } from "@/lib/agent/intent";
import type { SwiggyClient } from "@/lib/mcp/swiggy-client";
import {
  Cart,
  classifyReply,
  type GatesPassed,
  type InterruptPayload,
  type Recommendation,
} from "@/lib/agent/schemas";
import { tryParseCart } from "@/lib/agent/tools";
import { estimateCalories, gatePrompt } from "@/lib/agent/persona";
import {
  awaitGrace,
  consumeIdempotency,
  hashCart,
  makeIdempotencyKey,
  releaseIdempotency,
  startGraceTimer,
  todayUTC,
} from "@/lib/redis";
import { getCheckpointer } from "@/lib/agent/checkpointer";
import { safeLog } from "@/lib/redact";

export type RunStatus = "in-progress" | "cancelled" | "placed" | "duplicate" | "failed";

export const LastBiteState = Annotation.Root({
  userId: Annotation<string>(),
  query: Annotation<string>(),
  addressId: Annotation<string | null>({ reducer: (_, n) => n, default: () => null }),
  cart: Annotation<Cart | null>({ reducer: (_, n) => n, default: () => null }),
  // Replace, not merge. A merge reducer leaks gates from the previous
  // terminal run (placed/cancelled/etc.) into the next fresh run on the
  // same thread_id, which would skip the confirmation gates entirely on
  // every order after the first. Nodes manually merge with state.gatesPassed.
  gatesPassed: Annotation<GatesPassed>({
    reducer: (_, n) => n,
    default: () => ({}),
  }),
  orderId: Annotation<string | null>({ reducer: (_, n) => n, default: () => null }),
  status: Annotation<RunStatus>({ reducer: (_, n) => n, default: () => "in-progress" }),
  failureReason: Annotation<string | null>({ reducer: (_, n) => n, default: () => null }),
  // Set by the searcher when an exact match isn't found. The recommender
  // node interrupts with this list so the user can pick.
  recommendations: Annotation<Recommendation[] | null>({ reducer: (_, n) => n, default: () => null }),
  // Cached parsed intent so the recommender knows which dish to look up
  // at the picked restaurant without re-parsing the user's original query.
  intent: Annotation<Intent | null>({ reducer: (_, n) => n, default: () => null }),
});

export type LastBiteStateT = typeof LastBiteState.State;

function graceSeconds(): number {
  const raw = Number(process.env.LASTBITE_GRACE_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? raw : 30;
}

/** Swiggy MCP beta caps a single order at ₹1000. */
const MAX_ORDER_VALUE_RUPEES = 1000;

/** Synthetic cart used by offline smoke. Decoupled from real fixtures so
 *  smoke can verify the state machine independently of MCP shape drift. */
const SMOKE_CART: Cart = {
  restaurantId: "rest_smoke_001",
  restaurantName: "Paradise Smoke (offline)",
  items: [
    {
      itemId: "item_smoke_001",
      name: "Chicken Biryani",
      qty: 1,
      priceRupees: 449,
      caloriesKcal: 1100,
    },
  ],
  subtotalRupees: 449,
  deliveryRupees: 40,
  totalRupees: 489,
  etaMin: 42,
};

interface AddressLike {
  id?: unknown;
  addressId?: unknown;
  address_id?: unknown;
}

function parseRestaurants(raw: unknown): SwiggyRestaurant[] {
  if (!raw || typeof raw !== "object") return [];
  const list = (raw as { restaurants?: unknown[] }).restaurants ?? [];
  if (!Array.isArray(list)) return [];
  return list
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map<SwiggyRestaurant>((r) => ({
      id: String(r.id ?? ""),
      name: String(r.name ?? ""),
      availabilityStatus: typeof r.availabilityStatus === "string" ? r.availabilityStatus : undefined,
      distanceKm: typeof r.distanceKm === "number" ? r.distanceKm : undefined,
      avgRating: typeof r.avgRating === "number" ? r.avgRating : undefined,
      costForTwo: typeof r.costForTwo === "string" ? r.costForTwo : undefined,
    }))
    .filter((r) => r.id && r.name);
}

interface FilterReasons {
  hint?: string;
  rating?: string;
  distance?: string;
  closed?: string;
}

function whyDropped(r: SwiggyRestaurant, intent: Intent): FilterReasons {
  const reasons: FilterReasons = {};
  if ((r.availabilityStatus ?? "OPEN") !== "OPEN") reasons.closed = "currently closed";
  if (intent.distanceMaxKm != null && r.distanceKm != null && r.distanceKm > intent.distanceMaxKm) {
    reasons.distance = `${r.distanceKm}km away (>${intent.distanceMaxKm}km cap)`;
  }
  if (intent.ratingMin != null && r.avgRating != null && r.avgRating < intent.ratingMin) {
    reasons.rating = `${r.avgRating}★ (asked ≥${intent.ratingMin}★)`;
  }
  if (intent.restaurantHint) {
    if (!r.name.toLowerCase().includes(intent.restaurantHint.toLowerCase())) {
      reasons.hint = `name doesn't match "${intent.restaurantHint}"`;
    }
  }
  return reasons;
}

function applyHardFilters(rests: SwiggyRestaurant[], intent: Intent): SwiggyRestaurant[] {
  return rests.filter((r) => {
    if ((r.availabilityStatus ?? "OPEN") !== "OPEN") return false;
    if (intent.distanceMaxKm != null && r.distanceKm != null && r.distanceKm > intent.distanceMaxKm)
      return false;
    if (intent.ratingMin != null && r.avgRating != null && r.avgRating < intent.ratingMin)
      return false;
    if (intent.restaurantHint && !r.name.toLowerCase().includes(intent.restaurantHint.toLowerCase()))
      return false;
    return true;
  });
}

/** Sort restaurants best-first: highest rating, then closest. */
function sortByQuality(rests: SwiggyRestaurant[]): SwiggyRestaurant[] {
  return rests.slice().sort((a, b) => {
    const ra = a.avgRating ?? 0;
    const rb = b.avgRating ?? 0;
    if (ra !== rb) return rb - ra;
    const da = a.distanceKm ?? Infinity;
    const db = b.distanceKm ?? Infinity;
    return da - db;
  });
}

function toRecommendation(r: SwiggyRestaurant, intent: Intent): Recommendation {
  const reasons = whyDropped(r, intent);
  const reasonText = [reasons.closed, reasons.distance, reasons.rating, reasons.hint]
    .filter(Boolean)
    .join("; ");
  return {
    restaurantId: r.id,
    name: r.name,
    rating: r.avgRating ?? null,
    distanceKm: r.distanceKm ?? null,
    costForTwo: r.costForTwo ?? null,
    reason: reasonText || "near match",
  };
}

function pickBestMenuItem(raw: unknown, intent: Intent): SwiggyMenuItem | null {
  if (!raw || typeof raw !== "object") return null;
  const list = (raw as { items?: unknown[] }).items ?? [];
  if (!Array.isArray(list)) return null;
  let items = list
    .filter((it): it is SwiggyMenuItem => !!it && typeof it === "object")
    .filter((it) => (it.in_stock ?? 1) !== 0 && (it.in_stock ?? 1) !== false)
    .filter((it) => (it.menu_item_id ?? it.id) != null && it.name)
    // v1: skip items requiring variant/addon UX
    .filter((it) => !it.hasVariants && !it.hasAddons);
  if (intent.vegOnly) {
    items = items.filter((it) => it.is_veg === "1" || it.is_veg === 1 || it.is_veg === true);
  }
  if (intent.budgetMaxRupees != null) {
    items = items.filter((it) => Number(it.final_price ?? it.price ?? Infinity) <= intent.budgetMaxRupees!);
  }
  if (items.length === 0) return null;
  // Cheapest within the eligible set.
  return items.slice().sort((a, b) => {
    const pa = Number(a.final_price ?? a.price ?? Infinity);
    const pb = Number(b.final_price ?? b.price ?? Infinity);
    return pa - pb;
  })[0] ?? null;
}

function extractFirstAddressId(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const lists: unknown[] = [];
  if (Array.isArray(o.addresses)) lists.push(...(o.addresses as unknown[]));
  if (o.data && typeof o.data === "object" && Array.isArray((o.data as Record<string, unknown>).addresses)) {
    lists.push(...((o.data as Record<string, unknown>).addresses as unknown[]));
  }
  if (lists.length === 0 && Array.isArray(raw)) lists.push(...(raw as unknown[]));
  for (const item of lists) {
    if (!item || typeof item !== "object") continue;
    const a = item as AddressLike;
    const id = a.id ?? a.addressId ?? a.address_id;
    if (id != null) return String(id);
  }
  return null;
}

// Restaurant from search_restaurants results.
interface SwiggyRestaurant {
  id: string;
  name: string;
  availabilityStatus?: string;
  distanceKm?: number;
  avgRating?: number;
  costForTwo?: string;
}

interface SwiggyAddress {
  id: string;
  addressLine?: string;
  addressTag?: string;
  addressCategory?: string;
}

function parseAddresses(raw: unknown): SwiggyAddress[] {
  if (!raw || typeof raw !== "object") return [];
  const o = raw as Record<string, unknown>;
  const list = (Array.isArray(o.addresses)
    ? o.addresses
    : (o.data && typeof o.data === "object" && Array.isArray((o.data as Record<string, unknown>).addresses))
      ? ((o.data as Record<string, unknown>).addresses as unknown[])
      : []) as unknown[];
  return list
    .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
    .map<SwiggyAddress>((a) => ({
      id: String(a.id ?? a.addressId ?? a.address_id ?? ""),
      addressLine: typeof a.addressLine === "string" ? a.addressLine : undefined,
      addressTag: typeof a.addressTag === "string" ? a.addressTag : undefined,
      addressCategory: typeof a.addressCategory === "string" ? a.addressCategory : undefined,
    }))
    .filter((a) => a.id);
}

function pickAddress(addresses: SwiggyAddress[], tag: string | null): SwiggyAddress | null {
  if (addresses.length === 0) return null;
  if (!tag) return addresses[0];
  const lower = tag.toLowerCase();
  const exact = addresses.find(
    (a) => a.addressTag?.toLowerCase() === lower || a.addressCategory?.toLowerCase() === lower,
  );
  if (exact) return exact;
  // Loose: substring match on tag or addressLine.
  return (
    addresses.find(
      (a) =>
        a.addressTag?.toLowerCase().includes(lower) ||
        a.addressCategory?.toLowerCase().includes(lower) ||
        a.addressLine?.toLowerCase().includes(lower),
    ) ?? addresses[0]
  );
}

interface SwiggyMenuItem {
  menu_item_id?: string | number;
  id?: string | number;
  name?: string;
  price?: number;
  final_price?: number;
  is_veg?: string | number | boolean;
  hasAddons?: boolean;
  hasVariants?: boolean;
  in_stock?: number | boolean;
}

interface BuildCartResult {
  cart: Cart | null;
  failureReason?: string;
}

async function buildCartAt(
  swiggy: SwiggyClient,
  addressId: string,
  restaurant: SwiggyRestaurant,
  intent: Intent,
): Promise<BuildCartResult> {
  let menuRes;
  try {
    menuRes = await swiggy.callTool("search_menu", {
      addressId,
      query: intent.dish,
      restaurantIdOfAddedItem: restaurant.id,
    });
  } catch (err) {
    return { cart: null, failureReason: `Couldn't browse the menu at ${restaurant.name}.` };
  }

  const item = pickBestMenuItem(menuRes, intent);
  if (!item) {
    const budget = intent.budgetMaxRupees != null ? ` under ₹${intent.budgetMaxRupees}` : "";
    return {
      cart: null,
      failureReason: `No "${intent.dish}"${intent.vegOnly ? " (veg)" : ""}${budget} on the ${restaurant.name} menu.`,
    };
  }

  try {
    await swiggy.callTool("update_food_cart", {
      addressId,
      restaurantId: restaurant.id,
      cartItems: [
        { menu_item_id: String(item.menu_item_id ?? item.id), quantity: intent.qty },
      ],
    });
  } catch (err) {
    return { cart: null, failureReason: `Couldn't add to cart: ${(err as Error).message.split("\n")[0]}` };
  }

  let cartRes;
  try {
    cartRes = await swiggy.callTool("get_food_cart", {
      addressId,
      restaurantName: restaurant.name,
    });
  } catch (err) {
    return { cart: null, failureReason: `Couldn't read the cart: ${(err as Error).message.split("\n")[0]}` };
  }
  const cart = tryParseCart(cartRes, {
    restaurantIdHint: restaurant.id,
    restaurantNameHint: restaurant.name,
  });
  if (!cart) {
    return { cart: null, failureReason: "Cart wasn't readable. Swiggy may not deliver to your selected address." };
  }
  if (cart.totalRupees >= MAX_ORDER_VALUE_RUPEES) {
    return {
      cart: null,
      failureReason: `Cart is ₹${cart.totalRupees}. Swiggy MCP caps beta orders below ₹${MAX_ORDER_VALUE_RUPEES}.`,
    };
  }
  return { cart };
}

function formatRecommendations(recs: Recommendation[]): string {
  let text = "I couldn't find an exact match. Here are the closest options:\n\n";
  recs.forEach((r, i) => {
    let line = `${i + 1}. ${r.name}`;
    if (r.rating != null) line += ` — ${r.rating}★`;
    if (r.distanceKm != null) line += `, ${r.distanceKm}km away`;
    if (r.costForTwo) line += `, ${r.costForTwo}`;
    if (r.reason && r.reason !== "near match") line += `\n   why not exact: ${r.reason}`;
    text += `${line}\n`;
  });
  text += "\nReply with **1**, **2**, or **3** to pick — or describe a different order.";
  return text;
}

function parseRecommendationPick(reply: string): number | null {
  const m = reply.trim().match(/^#?\s*(\d+)\s*$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 1 && n <= 9 ? n - 1 : null;
}

export function makeLastBiteGraph(swiggy: SwiggyClient) {
  const searcher = async (state: LastBiteStateT) => {
    safeLog("agent.searcher.start", { userId: state.userId, queryLen: state.query.length });

    if (process.env.LASTBITE_OFFLINE === "1") {
      return { cart: SMOKE_CART, addressId: state.addressId ?? "smoke-addr-001" };
    }

    // 0) Parse the user's intent via Groq 8B (no regex).
    let intent: Intent;
    try {
      intent = await parseIntent(state.query);
    } catch (err) {
      safeLog("agent.searcher.intent-failed", { message: (err as Error).message });
      return {
        status: "failed" as RunStatus,
        failureReason:
          "Couldn't understand that order. Try: 'chocolate ice cream within 5km of MyHome under ₹300'.",
      };
    }
    safeLog("agent.searcher.intent", intent);

    // 1) Resolve the right delivery address. Honour intent.addressTag.
    let addresses: SwiggyAddress[] = [];
    try {
      addresses = parseAddresses(await swiggy.callTool("get_addresses", {}));
    } catch (err) {
      safeLog("agent.searcher.addresses-error", { message: (err as Error).message });
    }
    if (addresses.length === 0) {
      return {
        status: "failed" as RunStatus,
        failureReason: "No saved Swiggy address found. Add one in the Swiggy app and try again.",
      };
    }
    const address = pickAddress(addresses, intent.addressTag);
    let addressId = address?.id ?? null;
    if (intent.addressTag && address && address.addressTag?.toLowerCase() !== intent.addressTag.toLowerCase()) {
      safeLog("agent.searcher.address-tag-fuzzy", { asked: intent.addressTag, picked: address.addressTag });
    }
    if (!addressId) {
      return {
        status: "failed" as RunStatus,
        failureReason: "Couldn't pick a delivery address.",
      };
    }

    // 2) Restaurant search. Use restaurantHint if given else cuisine else dish.
    const queryText = intent.restaurantHint ?? intent.cuisine ?? intent.dish;
    let searchRes;
    try {
      searchRes = await swiggy.callTool("search_restaurants", { addressId, query: queryText });
    } catch (err) {
      const msg = (err as Error).message;
      if (/Address.*not found|address.*invalid/i.test(msg)) {
        // Stale-address self-heal (token-refresh case).
        try {
          const fresh = parseAddresses(await swiggy.callTool("get_addresses", {}));
          const newAddr = pickAddress(fresh, intent.addressTag);
          if (newAddr && newAddr.id !== addressId) {
            addressId = newAddr.id;
            searchRes = await swiggy.callTool("search_restaurants", { addressId, query: queryText });
          } else {
            throw err;
          }
        } catch (retryErr) {
          return {
            status: "failed" as RunStatus,
            failureReason: `Swiggy search failed: ${(retryErr as Error).message.split("\n")[0]}`,
          };
        }
      } else {
        return {
          status: "failed" as RunStatus,
          failureReason: `Swiggy search failed: ${msg.split("\n")[0]}`,
        };
      }
    }

    const allRestaurants = parseRestaurants(searchRes);
    if (allRestaurants.length === 0) {
      return {
        status: "failed" as RunStatus,
        failureReason: `No restaurants found for "${queryText}" near you.`,
      };
    }

    // 3) Apply hard filters from the intent. Sort survivors best-first.
    const matched = sortByQuality(applyHardFilters(allRestaurants, intent));

    if (matched.length === 0) {
      // Nothing met every constraint. Recommend the closest near-misses
      // (top 3 by quality) instead of placing an order.
      const close = sortByQuality(allRestaurants.filter((r) => (r.availabilityStatus ?? "OPEN") === "OPEN")).slice(0, 3);
      if (close.length === 0) {
        return {
          status: "failed" as RunStatus,
          failureReason: `No open restaurants for "${queryText}" right now.`,
        };
      }
      safeLog("agent.searcher.no-exact", { count: close.length });
      return {
        recommendations: close.map((r) => toRecommendation(r, intent)),
        intent,
        addressId,
      };
    }

    // 4) Try the top candidates' menus in order. First clean cart wins.
    safeLog("agent.searcher.candidates", { count: matched.length, top: matched[0].name });
    let firstFailure: string | undefined;
    for (const r of matched.slice(0, 3)) {
      const result = await buildCartAt(swiggy, addressId, r, intent);
      if (result.cart) {
        return { cart: result.cart, addressId, intent };
      }
      firstFailure ??= result.failureReason;
    }

    // 5) None of the matches yielded a buildable cart. Recommend.
    return {
      recommendations: matched.slice(0, 3).map((r) => toRecommendation(r, intent)),
      intent,
      addressId,
      failureReason: firstFailure,
    };
  };

  const recommender = async (state: LastBiteStateT) => {
    if (!state.recommendations || state.recommendations.length === 0 || !state.intent || !state.addressId) {
      return new Command({
        goto: END,
        update: { status: "failed" as RunStatus, failureReason: "No recommendations to show." },
      });
    }

    const text = formatRecommendations(state.recommendations);
    const reply = interrupt<InterruptPayload, string>({ kind: "recommendation", text });
    const cls = classifyReply(reply);
    if (cls === "stop") {
      return new Command({ goto: END, update: { status: "cancelled" as RunStatus } });
    }
    const idx = parseRecommendationPick(reply);
    if (idx === null || idx >= state.recommendations.length) {
      // User likely typed a fresh query. Drop recommendations and let the
      // chat surface a "describe again" prompt; don't auto-search.
      return new Command({
        goto: END,
        update: {
          status: "failed" as RunStatus,
          failureReason: "I didn't understand which option to pick. Send a fresh order to start over.",
          recommendations: null,
        },
      });
    }

    const picked = state.recommendations[idx];
    const restaurant: SwiggyRestaurant = {
      id: picked.restaurantId,
      name: picked.name,
      availabilityStatus: "OPEN",
      avgRating: picked.rating ?? undefined,
      distanceKm: picked.distanceKm ?? undefined,
      costForTwo: picked.costForTwo ?? undefined,
    };
    const result = await buildCartAt(swiggy, state.addressId, restaurant, state.intent);
    if (!result.cart) {
      return new Command({
        goto: END,
        update: {
          status: "failed" as RunStatus,
          failureReason: result.failureReason ?? `Couldn't build a cart at ${picked.name}.`,
          recommendations: null,
        },
      });
    }
    return { cart: result.cart, recommendations: null };
  };

  const confirmer = async (state: LastBiteStateT) => {
    const cart = state.cart;
    if (!cart) return new Command({ goto: END, update: { status: "failed" as RunStatus } });

    if (!state.gatesPassed.calorie) {
      const kcal = estimateCalories(cart);
      const text = await gatePrompt({ stage: "calorie", cart, estimateKcal: kcal });
      const reply = interrupt<InterruptPayload, string>({ kind: "gate", stage: "calorie", text });
      if (classifyReply(reply) !== "yes") {
        return new Command({ goto: END, update: { status: "cancelled" as RunStatus } });
      }
      return { gatesPassed: { ...state.gatesPassed, calorie: true } };
    }

    if (!state.gatesPassed.eta) {
      const text = await gatePrompt({ stage: "eta", cart });
      const reply = interrupt<InterruptPayload, string>({ kind: "gate", stage: "eta", text });
      if (classifyReply(reply) !== "yes") {
        return new Command({ goto: END, update: { status: "cancelled" as RunStatus } });
      }
      return { gatesPassed: { ...state.gatesPassed, eta: true } };
    }
    return {};
  };

  const placer = async (state: LastBiteStateT) => {
    const cart = state.cart;
    if (!cart) return new Command({ goto: END, update: { status: "failed" as RunStatus } });

    const text = await gatePrompt({ stage: "final", cart });
    const finalReply = interrupt<InterruptPayload, string>({
      kind: "final-gate",
      stage: "final",
      text,
      graceSeconds: graceSeconds(),
    });
    // CRITICAL: respect the user's reply at the final gate. The earlier
    // version ignored this return value and unconditionally proceeded
    // to place the order, which caused a real ₹321 Paradise Biryani
    // order to fire when "STOP" was sent. Never again.
    if (classifyReply(finalReply) !== "yes") {
      safeLog("agent.placer.final-gate-cancelled", {
        userId: state.userId,
        reply: finalReply.slice(0, 32),
      });
      return new Command({ goto: END, update: { status: "cancelled" as RunStatus } });
    }

    const orderRef = state.userId;
    const seconds = graceSeconds();
    await startGraceTimer(orderRef, seconds);
    const outcome = await awaitGrace(orderRef, seconds);
    if (outcome === "cancelled") {
      return new Command({ goto: END, update: { status: "cancelled" as RunStatus } });
    }

    const idemKey = makeIdempotencyKey(state.userId, hashCart(cart), todayUTC());
    const firstTime = await consumeIdempotency(idemKey);
    if (!firstTime) {
      return {
        status: "duplicate" as RunStatus,
        gatesPassed: { ...state.gatesPassed, final: true },
      };
    }

    if (!state.addressId) {
      await releaseIdempotency(idemKey);
      return {
        status: "failed" as RunStatus,
        failureReason: "Missing delivery address; please retry.",
      };
    }

    // Two-layer demo guard:
    //   1) Server kill-switch (LB_REAL_ORDERS) — no real orders unless set
    //   2) Per-user preference (mode:<phone> in Redis, default "demo")
    // The placer ONLY calls real place_food_order when BOTH allow it.
    const { effectiveMode } = await import("@/lib/user-prefs");
    const eff = await effectiveMode(state.userId);
    if (eff === "demo") {
      safeLog("agent.placer.demo-mode", { userId: state.userId });
      const demoId = `demo_${Date.now().toString(36)}`;
      return {
        status: "placed" as RunStatus,
        orderId: demoId,
        gatesPassed: { ...state.gatesPassed, final: true },
      };
    }

    try {
      // place_food_order's actual schema (per Swiggy MCP /tools/list):
      //   { addressId: string (req), paymentMethod?: string }
      // The cart itself is server-side state on Swiggy's side, so we
      // don't ship the items here. idempotency_key isn't part of the
      // schema — server-side dedup is governed by Swiggy.
      const result = await swiggy.callTool("place_food_order", {
        addressId: state.addressId,
        paymentMethod: "Cash",
      });
      safeLog("agent.placer.result", { userId: state.userId });
      return {
        status: "placed" as RunStatus,
        orderId: extractOrderId(result),
        gatesPassed: { ...state.gatesPassed, final: true },
      };
    } catch (err) {
      // Transient MCP failure: release the local idem claim so the user
      // can retry. The Swiggy MCP server is the source of truth on
      // idempotency for the actual order — passing the same key again is
      // safe.
      await releaseIdempotency(idemKey);
      safeLog("agent.placer.error", { userId: state.userId, message: (err as Error).message });
      throw err;
    }
  };

  const route = (
    state: LastBiteStateT,
  ): "recommender" | "confirmer" | "placer" | typeof END => {
    if (state.status !== "in-progress") return END;
    if (state.cart) {
      if (state.gatesPassed.calorie && state.gatesPassed.eta) return "placer";
      return "confirmer";
    }
    if (state.recommendations && state.recommendations.length > 0) return "recommender";
    return END;
  };

  return new StateGraph(LastBiteState)
    .addNode("searcher", searcher)
    .addNode("recommender", recommender)
    .addNode("confirmer", confirmer)
    .addNode("placer", placer)
    .addEdge(START, "searcher")
    .addConditionalEdges("searcher", route, ["recommender", "confirmer", "placer", END])
    .addConditionalEdges("recommender", route, ["recommender", "confirmer", "placer", END])
    .addConditionalEdges("confirmer", route, ["confirmer", "placer", END])
    .addEdge("placer", END);
}

export async function compileLastBite(swiggy: SwiggyClient) {
  const checkpointer = await getCheckpointer();
  return makeLastBiteGraph(swiggy).compile({ checkpointer });
}

function extractOrderId(result: unknown): string {
  if (typeof result === "string") {
    // Swiggy's place_food_order often returns a plain text confirmation
    // like "Order 237151187066628 placed successfully ..."
    const m = result.match(/\bOrder\s+(\d{10,20})/i) ?? result.match(/\b(\d{12,20})\b/);
    if (m) return m[1];
  }
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.order_id === "string" || typeof r.order_id === "number") return String(r.order_id);
    if (typeof r.orderId === "string" || typeof r.orderId === "number") return String(r.orderId);
    if (typeof r.id === "string" || typeof r.id === "number") return String(r.id);
    // Some responses wrap the cart in `data` with an `order_id` inside.
    const inner = (r.data ?? {}) as Record<string, unknown>;
    if (typeof inner.order_id === "string" || typeof inner.order_id === "number") {
      return String(inner.order_id);
    }
  }
  return "unknown";
}
