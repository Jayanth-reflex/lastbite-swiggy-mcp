import { NextResponse } from "next/server";
import { z } from "zod";
import { SwiggyClient, SwiggyMcpError } from "@/lib/mcp/swiggy-client";
import { getByocToken, normalisePhone } from "@/lib/byoc";
import { newRequestId, withLogContext } from "@/lib/log-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const Body = z.object({ phone: z.string().min(8) });

export async function POST(req: Request) {
  return withLogContext({ requestId: newRequestId() }, () => handle(req));
}

async function handle(req: Request) {
  const expected = process.env.LB_ADMIN_SECRET;
  if (!expected) return NextResponse.json({ error: "admin disabled" }, { status: 503 });
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${expected}`) return new NextResponse("forbidden", { status: 403 });

  const raw = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "phone required" }, { status: 400 });
  }

  const phone = normalisePhone(parsed.data.phone);
  const token = await getByocToken(phone);
  if (!token) return NextResponse.json({ error: "no token" }, { status: 404 });

  const swiggy = new SwiggyClient({ token });
  try {
    const orders = await swiggy.callTool("get_food_orders", {});
    return NextResponse.json({ ok: true, orders });
  } catch (err) {
    if (err instanceof SwiggyMcpError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    await swiggy.close();
  }
}
