/**
 * One-off: add a single ₹346 chicken biryani to your live Swiggy cart,
 * capture the populated `get_food_cart` shape, then flush_food_cart so
 * your account returns to the prior empty state.
 *
 * Run only when you can spare your live cart for ~2s.
 *
 *   npm run snapshot-cart
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { SwiggyClient } from "@/lib/mcp/swiggy-client";

const FIXTURES_DIR = path.join(process.cwd(), "fixtures", "swiggy", "food");

// Shah Ghouse / Chicken Biryani from the earlier get_restaurant_menu.
// If these change, re-pick from the latest get_restaurant_menu.json.
const RESTAURANT_ID = "33040";
const MENU_ITEM_ID = "6482239";
const QUANTITY = 1;

async function readToken(): Promise<string> {
  const direct = process.env.BYOC_DEV_TOKEN;
  if (direct) return direct;
  const body = await fs.readFile(path.join(process.cwd(), ".env.local"), "utf8").catch(() => "");
  for (const line of body.split("\n")) {
    const m = line.match(/^BYOC_DEV_TOKEN=(.+)$/);
    if (m) return m[1].trim();
  }
  throw new Error("BYOC_DEV_TOKEN missing — run `npm run capture` first.");
}

async function main() {
  console.log("=== snapshot-cart ===\n");
  const token = await readToken();
  const swiggy = new SwiggyClient({ token });

  try {
    const addrs = (await swiggy.callTool("get_addresses", {})) as { addresses?: Array<{ id: string }> };
    const addressId = addrs.addresses?.[0]?.id;
    if (!addressId) throw new Error("No addresses on this account");
    console.log(`addressId=${addressId}`);

    console.log(`adding 1× chicken biryani (rest=${RESTAURANT_ID}, item=${MENU_ITEM_ID})…`);
    // Server requires addressId at runtime even though _tools.json doesn't declare it.
    const updateRaw = await swiggy.callTool("update_food_cart", {
      addressId,
      restaurantId: RESTAURANT_ID,
      cartItems: [{ menu_item_id: MENU_ITEM_ID, quantity: QUANTITY }],
    });
    await write("update_food_cart.populated.json", updateRaw);

    console.log("fetching populated cart…");
    const cartRaw = await swiggy.callTool("get_food_cart", {
      addressId,
      restaurantName: "Shah Ghouse Hotel & Restaurant",
    });
    await write("get_food_cart.populated.json", cartRaw);

    console.log("flushing cart…");
    const flushRaw = await swiggy.callTool("flush_food_cart", {});
    await write("flush_food_cart.json", flushRaw);
    console.log("✓ cart restored to empty");
  } finally {
    await swiggy.close().catch(() => {});
  }
}

async function write(name: string, data: unknown) {
  await fs.writeFile(path.join(FIXTURES_DIR, name), `${JSON.stringify(data, null, 2)}\n`);
  console.log(`  saved ${name}`);
}

main().catch((err) => {
  console.error("\n✗ snapshot-cart failed:", err);
  process.exit(1);
});
