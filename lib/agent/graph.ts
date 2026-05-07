import {
  Annotation,
  Command,
  END,
  MessagesAnnotation,
  START,
  StateGraph,
  interrupt,
} from "@langchain/langgraph";
import { generateText, stepCountIs } from "ai";
import { groq } from "@ai-sdk/groq";
import type { SwiggyClient } from "@/lib/mcp/swiggy-client";
import { Cart, classifyReply, type GatesPassed, type InterruptPayload } from "@/lib/agent/schemas";
import { coerceToCart, tryParseCart } from "@/lib/agent/tools";
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

function agentModel() {
  return groq(process.env.LASTBITE_AGENT_MODEL ?? "llama-3.3-70b-versatile");
}

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

const SEARCHER_SYSTEM = `You are Last Bite, a Swiggy ordering agent. Use the Swiggy Food MCP tools to:
1. search_restaurants for a place matching the user's request.
2. Inspect the menu (search_menu / get_restaurant_menu) to pick items.
3. update_food_cart with one or more items, respecting any budget hint.
4. Call get_food_cart and stop.
NEVER call place_food_order — that is handled later. Powered by Swiggy.`;

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

    const tools = await swiggy.tools();
    const result = await generateText({
      model: agentModel(),
      tools,
      stopWhen: stepCountIs(10),
      maxRetries: 2,
      abortSignal: AbortSignal.timeout(20_000),
      system: `${SEARCHER_SYSTEM}\n\nUse addressId="${addressId}" for every tool that requires one. Do NOT call get_addresses.`,
      prompt: state.query,
    });
    const cart = coerceToCart(result);
    if (!cart) {
      return {
        status: "failed" as RunStatus,
        failureReason: "Couldn't build a cart from your request. Try: \"biryani from Paradise, ₹500\".",
      };
    }
    if (cart.totalRupees >= MAX_ORDER_VALUE_RUPEES) {
      return {
        status: "failed" as RunStatus,
        failureReason: `Cart is ₹${cart.totalRupees}. Swiggy MCP caps beta orders below ₹${MAX_ORDER_VALUE_RUPEES}. Use the Swiggy app for larger orders.`,
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
    interrupt<InterruptPayload, string>({
      kind: "final-gate",
      stage: "final",
      text,
      graceSeconds: graceSeconds(),
    });

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
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.order_id === "string") return r.order_id;
    if (typeof r.orderId === "string") return r.orderId;
    if (typeof r.id === "string") return r.id;
  }
  return "unknown";
}
