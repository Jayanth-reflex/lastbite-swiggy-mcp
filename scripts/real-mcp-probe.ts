/**
 * End-to-end probe that exercises SwiggyClient against the LIVE Swiggy
 * Food MCP using the BYOC_DEV_TOKEN captured by `npm run capture`.
 * Validates the MCP-result unwrap layer + tryParseCart against real
 * shapes. Does not place orders; does not mutate cart state.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { SwiggyClient, SwiggyMcpError } from "@/lib/mcp/swiggy-client";
import { tryParseCart } from "@/lib/agent/tools";

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

let failures = 0;
function check(label: string, ok: boolean, detail: string) {
  console[ok ? "log" : "error"](`${ok ? "✓" : "✗"} ${label} — ${detail}`);
  if (!ok) failures++;
}

async function main() {
  console.log("=== Last Bite — real MCP probe ===\n");
  const token = await readToken();
  const swiggy = new SwiggyClient({ token });

  try {
    // 1) get_addresses — our unwrap should yield { addresses: [...] }
    const addrs = (await swiggy.callTool("get_addresses", {})) as { addresses?: unknown[] };
    const list = Array.isArray(addrs?.addresses) ? addrs.addresses : [];
    check(
      "get_addresses returns a non-empty addresses array",
      list.length > 0,
      `${list.length} addresses found`,
    );
    if (list.length === 0) return;

    const first = list[0] as { id?: string; addressTag?: string };
    const addressId = first.id;
    check("first address has an id", typeof addressId === "string" && addressId.length > 0, `id=${addressId}`);
    if (!addressId) return;
    console.log(`   using addressId=${addressId} (${first.addressTag ?? "?"})\n`);

    // 2) search_restaurants with the resolved addressId
    const search = (await swiggy.callTool("search_restaurants", {
      addressId,
      query: "biryani",
    })) as { restaurants?: unknown[] };
    const rests = Array.isArray(search?.restaurants) ? search.restaurants : [];
    check(
      "search_restaurants returns restaurants for biryani",
      rests.length > 0,
      `${rests.length} restaurants returned`,
    );

    const firstRest = (rests[0] ?? {}) as { id?: string; name?: string; availabilityStatus?: string };
    check(
      "first restaurant has id + name + availabilityStatus",
      !!(firstRest.id && firstRest.name && firstRest.availabilityStatus),
      `${firstRest.name} (id=${firstRest.id}, status=${firstRest.availabilityStatus})`,
    );

    // 3) get_food_cart — cart will likely be empty (data:null) which we
    //    expect tryParseCart to handle by returning null.
    const cart = await swiggy.callTool("get_food_cart", { addressId });
    const parsed = tryParseCart(cart);
    const looksEmpty = (cart as { data?: unknown }).data == null;
    check(
      "get_food_cart unwrap survives the empty-cart case",
      looksEmpty ? parsed === null : parsed !== null,
      looksEmpty ? "cart is empty (data:null), tryParseCart returned null as expected" : "cart populated and parsed",
    );

    // 4) isError surfaces as SwiggyMcpError (not a silent null)
    let errored = false;
    try {
      await swiggy.callTool("search_restaurants", { addressId: "" });
    } catch (err) {
      errored = err instanceof SwiggyMcpError;
    }
    check(
      "isError propagates as SwiggyMcpError",
      errored,
      errored ? "thrown as expected" : "did NOT throw — unwrap is too permissive",
    );

    // 5) tryParseCart on a real populated cart fixture
    let parsedOk = false;
    let parseDetail = "no fixture on disk yet";
    try {
      const populated = JSON.parse(
        await fs.readFile(
          path.join(process.cwd(), "fixtures", "swiggy", "food", "get_food_cart.populated.json"),
          "utf8",
        ),
      );
      const parsed = tryParseCart(populated, { restaurantIdHint: "33040" });
      if (parsed) {
        parsedOk =
          parsed.items.length === 1 &&
          parsed.items[0].name === "Chicken Biryani" &&
          parsed.subtotalRupees === 346.5 &&
          parsed.totalRupees === 381 &&
          parsed.restaurantId === "33040" &&
          parsed.restaurantName === "Shah Ghouse Hotel & Restaurant";
        parseDetail = `items=${parsed.items.length} subtotal=${parsed.subtotalRupees} total=${parsed.totalRupees} restaurant=${parsed.restaurantName} eta=${parsed.etaMin ?? "?"}`;
      } else {
        parseDetail = "tryParseCart returned null";
      }
    } catch (err) {
      parseDetail = `read failed: ${(err as Error).message}`;
    }
    check("tryParseCart handles real populated Swiggy cart", parsedOk, parseDetail);
  } finally {
    await swiggy.close().catch(() => {});
  }

  console.log(`\n=== ${failures === 0 ? "PASS" : `FAIL (${failures} failed)`} ===\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\nProbe crashed:", err);
  process.exit(2);
});
