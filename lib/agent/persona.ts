import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import type { Cart } from "@/lib/agent/schemas";
import { safeLog } from "@/lib/redact";

const PERSONA_MODEL = process.env.LASTBITE_PERSONA_MODEL ?? "claude-haiku-4-5";

const SYSTEM = `You are Last Bite — a friendly Hinglish-leaning agent that helps Indian users
confirm Swiggy food orders. Voice: warm, terse, mildly funny, never preachy. Always end with
"Powered by Swiggy". COD-only, non-cancellable orders, so confirmation must feel deliberate.
Reply in <= 2 short sentences plus the Powered-by line.`;

interface GateInput {
  stage: "calorie" | "eta" | "final";
  cart: Cart;
  estimateKcal?: number;
}

export async function gatePrompt(input: GateInput): Promise<string> {
  if (process.env.SKIP_PERSONA === "1") return fallback(input);
  try {
    const result = await generateText({
      model: anthropic(PERSONA_MODEL),
      system: SYSTEM,
      prompt: gateUserPrompt(input),
    });
    return result.text.trim();
  } catch (err) {
    // The fallback works fine functionally, but if the persona LLM is
    // misconfigured (e.g. ANTHROPIC_API_KEY unset) every gate silently
    // falls back to boilerplate copy and the product loses its voice.
    // Log so we know.
    safeLog("agent.persona.fallback", {
      stage: input.stage,
      message: (err as Error).message,
    });
    return fallback(input);
  }
}

function gateUserPrompt({ stage, cart, estimateKcal }: GateInput): string {
  const summary = cart.items.map((i) => `${i.qty}x ${i.name}`).join(", ");
  if (stage === "calorie") {
    return `Cart: ${summary} from ${cart.restaurantName}. Total ₹${cart.totalRupees}. Est. calories: ~${estimateKcal ?? "?"} kcal. Ask: still going through with it? Two short sentences.`;
  }
  if (stage === "eta") {
    return `Cart: ${summary}. ETA ${cart.etaMin ?? "?"} min. Ask: ETA OK? Two short sentences.`;
  }
  return `Final gate. Cart: ${summary} from ${cart.restaurantName}, total ₹${cart.totalRupees}. Tell user a 30-second grace timer is starting; reply STOP to cancel; otherwise the order goes in. Two short sentences.`;
}

function fallback({ stage, cart, estimateKcal }: GateInput): string {
  const total = `₹${cart.totalRupees}`;
  if (stage === "calorie") {
    return `~${estimateKcal ?? "?"} kcal incoming for ${total}. Still go? Reply YES or STOP. Powered by Swiggy.`;
  }
  if (stage === "eta") {
    return `ETA ${cart.etaMin ?? "?"} min, total ${total}. OK? Reply YES or STOP. Powered by Swiggy.`;
  }
  return `Final gate. ${total} from ${cart.restaurantName}. 30s grace timer started — reply STOP to cancel. Powered by Swiggy.`;
}

export function estimateCalories(cart: Cart): number {
  return cart.items.reduce((sum, item) => {
    const kcal = item.caloriesKcal ?? heuristicKcal(item.name);
    return sum + kcal * item.qty;
  }, 0);
}

function heuristicKcal(name: string): number {
  const n = name.toLowerCase();
  if (n.includes("biryani")) return 900;
  if (n.includes("pizza")) return 850;
  if (n.includes("burger")) return 600;
  if (n.includes("dosa")) return 400;
  if (n.includes("salad")) return 250;
  return 500;
}
