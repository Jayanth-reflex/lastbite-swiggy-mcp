import {
  Annotation,
  Command,
  END,
  MessagesAnnotation,
  START,
  StateGraph,
  interrupt,
} from "@langchain/langgraph";
import { parseIntent } from "@/lib/agent/intent";
import type { SwiggyClient } from "@/lib/mcp/swiggy-client";
import { Cart, classifyReply, type GatesPassed, type InterruptPayload } from "@/lib/agent/schemas";
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
  ...MessagesAnnotation.spec,
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

function pickBestRestaurant(raw: unknown, hint: string | null): SwiggyRestaurant | null {
  if (!raw || typeof raw !== "object") return null;
  const list = (raw as { restaurants?: unknown[] }).restaurants ?? [];
  if (!Array.isArray(list)) return null;
  const open = list
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({
      id: String(r.id ?? ""),
      name: String(r.name ?? ""),
      availabilityStatus: typeof r.availabilityStatus === "string" ? r.availabilityStatus : undefined,
      distanceKm: typeof r.distanceKm === "number" ? r.distanceKm : undefined,
      avgRating: typeof r.avgRating === "number" ? r.avgRating : undefined,
    }))
    .filter((r) => r.id && r.name && (r.availabilityStatus ?? "OPEN") === "OPEN");
  if (open.length === 0) return null;
  if (hint) {
    const lower = hint.toLowerCase();
    const matched = open.find((r) => r.name.toLowerCase().includes(lower));
    if (matched) return matched;
  }
  return open[0];
}

function pickBestMenuItem(raw: unknown, budget: number | null): SwiggyMenuItem | null {
  if (!raw || typeof raw !== "object") return null;
  const list = (raw as { items?: unknown[] }).items ?? [];
  if (!Array.isArray(list)) return null;
  const items = list
    .filter((it): it is SwiggyMenuItem => !!it && typeof it === "object")
    .filter((it) => (it.in_stock ?? 1) !== 0 && (it.in_stock ?? 1) !== false)
    .filter((it) => (it.menu_item_id ?? it.id) != null && it.name);
  if (items.length === 0) return null;
  const priceOf = (it: SwiggyMenuItem) => Number(it.final_price ?? it.price ?? Infinity);
  // Prefer items without variants/addons (simpler v1 path) — but accept any if none.
  const simple = items.filter((it) => !it.hasVariants && !it.hasAddons);
  const candidates = simple.length > 0 ? simple : items;
  // Apply budget cap.
  const inBudget = budget ? candidates.filter((it) => priceOf(it) <= budget) : candidates;
  const pool = inBudget.length > 0 ? inBudget : candidates;
  // Cheapest first within the pool.
  return pool.slice().sort((a, b) => priceOf(a) - priceOf(b))[0] ?? null;
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

export function makeLastBiteGraph(swiggy: SwiggyClient) {
  const searcher = async (state: LastBiteStateT) => {
    safeLog("agent.searcher.start", { userId: state.userId, queryLen: state.query.length });

    if (process.env.LASTBITE_OFFLINE === "1") {
      return { cart: SMOKE_CART, addressId: state.addressId ?? "smoke-addr-001" };
    }

    // Resolve a delivery address once per run before invoking the LLM.
    let addressId = state.addressId;
    if (!addressId) {
      try {
        const addrs = await swiggy.callTool("get_addresses", {});
        addressId = extractFirstAddressId(addrs);
      } catch (err) {
        safeLog("agent.searcher.addresses-error", { message: (err as Error).message });
      }
      if (!addressId) {
        return {
          status: "failed" as RunStatus,
          failureReason: "No saved Swiggy address found. Add one in the Swiggy app and try again.",
        };
      }
    }

    // Deterministic search: cheap regex / 8B intent parse, then a fixed
    // sequence of Swiggy MCP calls. Avoids the agentic-LLM tool-loop
    // which blows past free-tier token caps and is unreliable on small
    // open-source models.
    let intent;
    try {
      intent = await parseIntent(state.query);
    } catch (err) {
      safeLog("agent.searcher.intent-failed", { message: (err as Error).message });
      return {
        status: "failed" as RunStatus,
        failureReason: "Couldn't parse your order. Try: \"biryani from Paradise, ₹500\".",
      };
    }
    safeLog("agent.searcher.intent", intent);

    // 1) Search restaurants. Prefer the user's restaurant hint when
    //    given; otherwise search by dish.
    const restaurantQuery = intent.restaurantHint ?? intent.dish;
    let searchRes;
    try {
      searchRes = await swiggy.callTool("search_restaurants", {
        addressId,
        query: restaurantQuery,
      });
    } catch (err) {
      return {
        status: "failed" as RunStatus,
        failureReason: `Swiggy couldn't run that search: ${(err as Error).message.split("\n")[0]}`,
      };
    }
    const restaurant = pickBestRestaurant(searchRes, intent.restaurantHint);
    if (!restaurant) {
      return {
        status: "failed" as RunStatus,
        failureReason: `No open ${intent.restaurantHint ?? intent.dish} place found near you.`,
      };
    }
    safeLog("agent.searcher.restaurant", { id: restaurant.id, name: restaurant.name });

    // 2) Search the menu within that restaurant for the dish.
    let menuRes;
    try {
      menuRes = await swiggy.callTool("search_menu", {
        addressId,
        query: intent.dish,
        restaurantIdOfAddedItem: restaurant.id,
      });
    } catch (err) {
      return {
        status: "failed" as RunStatus,
        failureReason: `Couldn't browse the menu: ${(err as Error).message.split("\n")[0]}`,
      };
    }
    const item = pickBestMenuItem(menuRes, intent.budgetRupees);
    if (!item) {
      return {
        status: "failed" as RunStatus,
        failureReason: intent.budgetRupees
          ? `No "${intent.dish}" under ₹${intent.budgetRupees} at ${restaurant.name}.`
          : `No "${intent.dish}" on the ${restaurant.name} menu.`,
      };
    }
    safeLog("agent.searcher.item", { id: item.menu_item_id, name: item.name, price: item.price ?? item.final_price });

    // 3) Add to cart. Skip items requiring variant/addon selection in v1.
    if (item.hasVariants || item.hasAddons) {
      return {
        status: "failed" as RunStatus,
        failureReason: `"${item.name}" needs customisation (size / addons) which Last Bite v1 doesn't support yet. Try a simpler item.`,
      };
    }

    try {
      await swiggy.callTool("update_food_cart", {
        addressId,
        restaurantId: restaurant.id,
        cartItems: [{ menu_item_id: String(item.menu_item_id ?? item.id), quantity: intent.qty }],
      });
    } catch (err) {
      return {
        status: "failed" as RunStatus,
        failureReason: `Couldn't add to cart: ${(err as Error).message.split("\n")[0]}`,
      };
    }

    // 4) Fetch the populated cart.
    let cartRes;
    try {
      cartRes = await swiggy.callTool("get_food_cart", {
        addressId,
        restaurantName: restaurant.name,
      });
    } catch (err) {
      return {
        status: "failed" as RunStatus,
        failureReason: `Couldn't read the cart: ${(err as Error).message.split("\n")[0]}`,
      };
    }
    const cart = tryParseCart(cartRes, {
      restaurantIdHint: restaurant.id,
      restaurantNameHint: restaurant.name,
    });
    if (!cart) {
      return {
        status: "failed" as RunStatus,
        failureReason: "Cart wasn't readable. Swiggy may not deliver to your selected address.",
      };
    }
    if (cart.totalRupees >= MAX_ORDER_VALUE_RUPEES) {
      return {
        status: "failed" as RunStatus,
        failureReason: `Cart is ₹${cart.totalRupees}. Swiggy MCP caps beta orders below ₹${MAX_ORDER_VALUE_RUPEES}.`,
      };
    }
    return { cart, addressId };
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

    // Demo mode: NEVER call Swiggy place_food_order unless explicitly
    // opted in via LB_REAL_ORDERS=1 on the server. Default-safe to
    // protect users + tests from accidental ₹ charges.
    if (process.env.LB_REAL_ORDERS !== "1") {
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

  const route = (state: LastBiteStateT): "confirmer" | "placer" | typeof END => {
    if (state.status !== "in-progress") return END;
    if (!state.cart) return END;
    if (state.gatesPassed.calorie && state.gatesPassed.eta) return "placer";
    return "confirmer";
  };

  return new StateGraph(LastBiteState)
    .addNode("searcher", searcher)
    .addNode("confirmer", confirmer)
    .addNode("placer", placer)
    .addEdge(START, "searcher")
    .addConditionalEdges("searcher", route, ["confirmer", "placer", END])
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
