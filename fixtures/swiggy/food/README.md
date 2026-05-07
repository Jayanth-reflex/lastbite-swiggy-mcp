# Swiggy Food MCP fixtures

Capture real responses from your Claude Desktop Swiggy session and drop them
here as JSON, named after the tool that produced them.

Required for `USE_FIXTURES=1` mode:

| File | Tool | Notes |
| --- | --- | --- |
| `search_restaurants.json` | `search_restaurants` | Result for "biryani Paradise Hyderabad" or similar |
| `search_menu.json` | `search_menu` | Menu items matching the query |
| `get_restaurant_menu.json` | `get_restaurant_menu` | Full restaurant menu payload |
| `update_food_cart.json` | `update_food_cart` | Cart after adding 1 item |
| `get_food_cart.json` | `get_food_cart` | Cart with subtotal, delivery, total — `tryParseCart` reads this |
| `place_food_order.json` | `place_food_order` | Order confirmation — must contain `order_id` |
| `track_food_order.json` | `track_food_order` | Mid-flight status payload |

Workflow:
1. In Claude Desktop, run a real flow against the Swiggy Food MCP.
2. Copy each tool's raw JSON output into the matching file above.
3. Run `USE_FIXTURES=1 npm run dev` and probe `/api/agent`.

`tryParseCart` in `lib/agent/tools.ts` is permissive — it tolerates
multiple field-name conventions (`item_id` vs `itemId`, `total` vs
`grand_total`, etc.). Real fixtures will let us tighten this in v2.
