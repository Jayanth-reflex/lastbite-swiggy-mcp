import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import path from "node:path";
import { promises as fs } from "node:fs";
import { safeLog } from "@/lib/redact";

export type SwiggySurface = "food" | "instamart" | "dineout";

export class SwiggyMcpError extends Error {
  constructor(public readonly tool: string, public readonly text: string) {
    super(`Swiggy MCP ${tool} failed: ${text.slice(0, 240)}`);
    this.name = "SwiggyMcpError";
  }
}

interface CallToolResult {
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

function unwrapMcpResult(raw: unknown, toolName: string): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const r = raw as CallToolResult;
  // Fixture files for some tools were saved post-unwrap (no envelope) —
  // return as-is when the envelope keys are absent.
  if (!("isError" in r) && !("structuredContent" in r) && !("content" in r)) {
    return raw;
  }
  if (r.isError) {
    const text = r.content?.[0]?.text ?? "Unknown MCP error";
    throw new SwiggyMcpError(toolName, text);
  }
  const sc = r.structuredContent;
  if (sc && typeof sc === "object" && Object.keys(sc as object).length > 0) {
    return sc;
  }
  const text = r.content?.[0]?.text;
  if (typeof text === "string") {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return r;
}

const DEFAULT_URLS: Record<SwiggySurface, string> = {
  food: process.env.SWIGGY_FOOD_MCP_URL ?? "https://mcp.swiggy.com/food",
  instamart: process.env.SWIGGY_INSTAMART_MCP_URL ?? "https://mcp.swiggy.com/im",
  dineout: process.env.SWIGGY_DINEOUT_MCP_URL ?? "https://mcp.swiggy.com/dineout",
};

const FIXTURES_ROOT = path.join(process.cwd(), "fixtures", "swiggy");

export interface SwiggyClientOptions {
  /** User's BYOC bearer token from their Claude Desktop OAuth session. */
  token: string;
  surface?: SwiggySurface;
  /** Override the MCP server URL (handy for local mocks). */
  url?: string;
}

/**
 * BYOC Swiggy MCP client. Each instance is owned by exactly one end-user —
 * never share across users, never log the bearer token (redact.ts handles
 * stray `Bearer ey...` strings, but don't pass tokens through error
 * messages either).
 */
export class SwiggyClient {
  private clientPromise: Promise<MCPClient> | null = null;
  private toolsPromise: Promise<ToolSet> | null = null;
  private readonly surface: SwiggySurface;
  private readonly url: string;
  private readonly fixturesEnabled: boolean;

  constructor(private opts: SwiggyClientOptions) {
    this.surface = opts.surface ?? "food";
    this.url = opts.url ?? DEFAULT_URLS[this.surface];
    this.fixturesEnabled = process.env.USE_FIXTURES === "1";
  }

  private async client(): Promise<MCPClient> {
    if (this.clientPromise) return this.clientPromise;
    safeLog("swiggy.connect", { surface: this.surface, url: this.url });
    this.clientPromise = createMCPClient({
      transport: {
        type: "http",
        url: this.url,
        headers: { Authorization: `Bearer ${this.opts.token}` },
      },
    });
    return this.clientPromise;
  }

  /** Returns the tool set ready to feed into `streamText({ tools })`. */
  async tools(): Promise<ToolSet> {
    if (this.toolsPromise) return this.toolsPromise;
    if (this.fixturesEnabled) {
      this.toolsPromise = Promise.resolve(this.fixtureTools());
      return this.toolsPromise;
    }
    this.toolsPromise = this.client().then((c) => c.tools() as unknown as Promise<ToolSet>);
    return this.toolsPromise;
  }

  /** Direct invocation, used by the agent for non-LLM tool chains. Returns
   *  the unwrapped data (parsed JSON when possible). Throws SwiggyMcpError
   *  on `isError: true`. Fixture mode short-circuits to disk and returns
   *  the file contents already unwrapped (we save unwrapped JSON there). */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (this.fixturesEnabled) {
      const raw = await this.fromFixture(name, args);
      return unwrapMcpResult(raw, name);
    }
    const tools = await this.tools();
    const t = tools[name] as { execute?: (input: unknown, options: unknown) => Promise<unknown> } | undefined;
    if (!t?.execute) throw new Error(`Swiggy MCP tool not found or not executable: ${name}`);
    const raw = await t.execute(args, {});
    return unwrapMcpResult(raw, name);
  }

  async close(): Promise<void> {
    if (!this.clientPromise) return;
    const c = await this.clientPromise;
    await c.close().catch(() => {});
    this.clientPromise = null;
    this.toolsPromise = null;
  }

  /**
   * Lightweight token-validation probe: opens an MCP session with the
   * supplied token and checks that the server returns a tools list.
   * Useful for ad-hoc token sanity checks (advanced flows that don't go
   * through the OAuth callback).
   */
  static async validate(token: string, surface: SwiggySurface = "food"): Promise<boolean> {
    const probe = new SwiggyClient({ token, surface });
    try {
      const tools = await probe.tools();
      return Object.keys(tools).length > 0;
    } catch {
      return false;
    } finally {
      await probe.close().catch(() => {});
    }
  }

  private async fromFixture(name: string, args: Record<string, unknown>): Promise<unknown> {
    const file = path.join(FIXTURES_ROOT, this.surface, `${name}.json`);
    const txt = await fs.readFile(file, "utf8").catch(() => null);
    if (!txt) {
      throw new Error(
        `Missing fixture for ${name}: ${file}. Capture from Claude Desktop and save as JSON.`,
      );
    }
    safeLog("swiggy.fixture", { name, args });
    return JSON.parse(txt);
  }

  private fixtureTools(): ToolSet {
    const wrap = (name: string, description: string) =>
      tool({
        description,
        inputSchema: z.object({}).passthrough(),
        execute: async (args: unknown) =>
          this.fromFixture(name, (args ?? {}) as Record<string, unknown>),
      });
    return {
      search_restaurants: wrap("search_restaurants", "Search Swiggy restaurants by query, area, or cuisine."),
      search_menu: wrap("search_menu", "Search dishes across restaurants matching a query."),
      get_restaurant_menu: wrap("get_restaurant_menu", "Fetch the full menu for a specific restaurant id."),
      update_food_cart: wrap("update_food_cart", "Add/remove items in the active Swiggy food cart."),
      get_food_cart: wrap("get_food_cart", "Read the current cart with subtotal, delivery, total."),
      place_food_order: wrap("place_food_order", "COD-only, non-cancellable. Confirm with the user before calling."),
      track_food_order: wrap("track_food_order", "Get current status and ETA for an order id."),
    };
  }
}
