import { generateObject } from "ai";
import { groq } from "@ai-sdk/groq";
import { z } from "zod";

export const Intent = z.object({
  dish: z
    .string()
    .describe("The specific dish or food item the user wants. Examples: 'chocolate ice cream', 'chicken biryani', 'paneer butter masala'."),
  cuisine: z
    .string()
    .nullable()
    .describe("Cuisine category if mentioned (e.g. 'Indian', 'Italian', 'Chinese'). null if not specified."),
  restaurantHint: z
    .string()
    .nullable()
    .describe("Restaurant name if the user named one (e.g. 'Paradise', 'Pista House'). null if not specified."),
  addressTag: z
    .string()
    .nullable()
    .describe("Saved-address label if the user said 'at <name>' or 'near <name>' or 'MyHome'/'Work'/'Gym' etc. Examples: 'MyHome', 'Work', 'Gym'. null if not specified."),
  budgetMaxRupees: z
    .number()
    .int()
    .nullable()
    .describe("Maximum budget in INR. Catch ₹500, Rs 300, '300 rupees', '₹300 budget', 'under 400'. null if not specified."),
  ratingMin: z
    .number()
    .min(0)
    .max(5)
    .nullable()
    .describe("Minimum restaurant rating out of 5. Phrases like 'best rated', 'top rated', 'good rating' imply 4.0. 'highly rated' implies 4.2. null if no rating constraint."),
  distanceMaxKm: z
    .number()
    .nullable()
    .describe("Maximum delivery distance in km. Catch 'within 5km', '7 km radius', 'nearby' (=3km). null if no distance constraint."),
  qty: z
    .number()
    .int()
    .min(1)
    .max(10)
    .default(1)
    .describe("How many of the item, default 1. Catch '2 plates', 'two pieces', '3x'."),
  vegOnly: z
    .boolean()
    .nullable()
    .describe("True if the user explicitly wants veg only. False if they explicitly say non-veg. null if not specified."),
});
export type Intent = z.infer<typeof Intent>;

const INTENT_MODEL = process.env.LASTBITE_INTENT_MODEL ?? "llama-3.1-8b-instant";

const SYSTEM = `Extract structured order intent from the user's message.

The user is ordering food on Swiggy. Their message may be in English or
Hinglish. Extract every constraint they specify exactly — do NOT invent
values. Currency is INR (₹).

If the user implies a constraint without giving a number, use these
defaults: 'best rated' or 'top rated' → ratingMin 4.0; 'highly rated' →
4.2; 'nearby' (no distance given) → distanceMaxKm 3.

For addressTag: only fill it when the user says 'at <name>' / 'near
<name>' / 'from <name> address' / 'MyHome' / 'Work' / 'Gym' etc.
Restaurant names go in restaurantHint, not addressTag.

If the user names a restaurant explicitly (e.g. 'from Paradise'), put it
in restaurantHint and leave cuisine null unless the user also said the
cuisine independently.`;

export async function parseIntent(text: string): Promise<Intent> {
  const result = await generateObject({
    model: groq(INTENT_MODEL),
    schema: Intent,
    system: SYSTEM,
    prompt: text,
    abortSignal: AbortSignal.timeout(15_000),
    maxRetries: 0,
  });
  return result.object;
}
