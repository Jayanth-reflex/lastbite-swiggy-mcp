import { generateObject } from "ai";
import { groq } from "@ai-sdk/groq";
import { z } from "zod";

export const Intent = z.object({
  dish: z
    .string()
    .describe("The dish or cuisine the user wants. Examples: 'biryani', 'pizza', 'paneer tikka'"),
  restaurantHint: z
    .string()
    .nullable()
    .describe("Restaurant name they mentioned, or null if they didn't"),
  budgetRupees: z
    .number()
    .int()
    .nullable()
    .describe("Maximum amount they're willing to spend in INR, or null if unspecified"),
  qty: z.number().int().min(1).max(10).default(1).describe("How many of the item they want"),
});
export type Intent = z.infer<typeof Intent>;

const INTENT_MODEL = process.env.LASTBITE_INTENT_MODEL ?? "llama-3.1-8b-instant";

const SYSTEM = `Extract structured order intent from a single short user message in English/Hinglish.
Currency in INR. If the user mentions a restaurant by name, capture it in restaurantHint;
otherwise leave it null. Only extract from what the user actually said — do not invent values.`;

/**
 * Two-step parsing: cheap regex first, LLM only if it fails. The LLM call
 * uses Groq 8B (500K TPD free tier) and a tight structured-output schema,
 * keeping per-call cost ~200 tokens.
 */
export async function parseIntent(text: string): Promise<Intent> {
  const cheap = regexIntent(text);
  if (cheap) return cheap;

  const result = await generateObject({
    model: groq(INTENT_MODEL),
    schema: Intent,
    system: SYSTEM,
    prompt: text,
    abortSignal: AbortSignal.timeout(15_000),
  });
  return result.object;
}

const RUPEES_RE = /(?:₹|rs\.?|inr|rupees?)\s*(\d{2,5})|(\d{2,5})\s*(?:₹|rs\.?|inr|rupees?|rupees? budget|budget)/i;
const QTY_RE = /\b(\d+)\s*(?:plates?|pieces?|orders?|x|×)\b/i;

function regexIntent(text: string): Intent | null {
  const lower = text.toLowerCase().trim();
  if (lower.length < 3 || lower.length > 200) return null;

  // Budget
  const budgetMatch = lower.match(RUPEES_RE);
  const budget = budgetMatch ? Number(budgetMatch[1] ?? budgetMatch[2]) : null;

  // Restaurant hint: "from <Name>" or "<Name> ka biryani" patterns. Keep loose.
  const restaurantMatch =
    text.match(/from\s+([A-Z][A-Za-z'&\s]{1,30}?)(?:\s*[,;]|\s+for|\s+₹|\s+rs|$)/) ??
    text.match(/at\s+([A-Z][A-Za-z'&\s]{1,30}?)(?:\s*[,;]|\s+for|\s+₹|\s+rs|$)/);
  const restaurantHint = restaurantMatch ? restaurantMatch[1].trim() : null;

  // Quantity
  const qtyMatch = text.match(QTY_RE);
  const qty = qtyMatch ? Math.min(10, Math.max(1, Number(qtyMatch[1]))) : 1;

  // Dish: take the first 1-3 nouny words. Heuristic — fall back to LLM if no obvious dish.
  const stripped = text
    .replace(RUPEES_RE, "")
    .replace(/from\s+[A-Z][A-Za-z'&\s]{1,30}/gi, "")
    .replace(/at\s+[A-Z][A-Za-z'&\s]{1,30}/gi, "")
    .replace(QTY_RE, "")
    .replace(/[,.;!?]/g, " ")
    .replace(/\b(order|please|pls|can\s*you|i\s*want|get\s*me|me|a|an|the|some|for|budget)\b/gi, "")
    .trim();
  const dishWords = stripped.split(/\s+/).filter((w) => w.length > 2).slice(0, 3);
  if (dishWords.length === 0) return null;
  const dish = dishWords.join(" ");

  return { dish, restaurantHint, budgetRupees: budget, qty };
}
