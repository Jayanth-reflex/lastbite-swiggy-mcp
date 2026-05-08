# Builders Club — Submission Packet

Use the template below for the email to **builders@swiggy.in**. Attach the demo video link, screenshot, and source URL. Don't send if anything in `## Pre-flight` is unchecked.

---

## Pre-flight

- [ ] BYOC token-paste end-to-end tested at swiggy-mcp.vercel.app/connect
- [ ] One demo order placed in **demo mode** (proves the gates fire)
- [ ] One real order placed in **live mode** (proves the placer works against real Swiggy MCP) — only with intent
- [ ] Demo video recorded and uploaded (Drive / YouTube unlisted is fine)
- [ ] Whitelist issue [#53](https://github.com/Swiggy/swiggy-mcp-server-manifest/issues/53) is open and reflects the current state
- [ ] README on the GitHub repo has the screenshot, BYOC steps, and stack

---

## Email template

**To:** builders@swiggy.in
**Cc:** (your own email — keep a copy in your sent folder)
**Subject:** Builders Club application — Last Bite (Swiggy Food MCP, with three-gate confirmation)

---

Hi team,

I'd like to apply to the Swiggy Builders Club for **Last Bite** — a web agent built on the Swiggy Food MCP server.

**The product.** Last Bite takes a natural-language order ("biryani at Paradise, ₹500" or "chocolate ice cream within 7km of MyHome, best rated, under ₹300") and walks the user through a three-stage human-in-the-loop confirmation — calorie, ETA, final — followed by a 30-second STOP grace timer before any `place_food_order` is called. COD-only by design, ₹999 cap during beta. The point: Swiggy MCP orders cannot be cancelled after they fire, so the UX should make sure they fire intentionally.

**Live:** https://swiggy-mcp.vercel.app
**Source:** https://github.com/Jayanth-reflex/swiggy-mcp
**Demo video (90s):** [your video link here]
**Whitelist request:** https://github.com/Swiggy/swiggy-mcp-server-manifest/issues/53

**Stack.** Next.js 16 + LangGraph 1.3, Vercel AI SDK, `@ai-sdk/mcp` against the Swiggy Food MCP server. Intent extraction via Groq Llama 3.1 8B with a Zod-validated schema (no regex, no hallucination). Restaurant filtering and recommendations are deterministic TypeScript on Swiggy's response — no agentic LLM tool loops. Token storage AES-256-GCM at rest in Upstash Redis with a 30-day TTL and a scrypt-derived per-purpose key. Idempotency via `sha256(user_id, cart_hash, day)`.

**Safety posture I'd like you to review.**
- Two-layer kill switch on live orders (`LB_REAL_ORDERS=1` env + per-user mode toggle)
- Three `interrupt()` gates in the LangGraph supervisor before the placer node
- 30-second grace timer with STOP on the final gate
- "Powered by Swiggy" attribution on every surface that renders Swiggy data
- DPDP-aligned `/privacy` page; anonymous-by-default with a `FORGET ME` reply path

**Current bridge.** Until our redirect URI is whitelisted (issue #53 above), the live site runs in BYOC mode — users authorize Swiggy MCP inside Claude Desktop, then paste their bearer token into `/connect`. We never see the OTP or password.

**Roadmap.** Last Bite is Project 1 of 5 — Trail (vernacular WhatsApp + Apple Watch tracking), ChaiCal (Dineout group coordinator), Bharat Pantry (Instamart auto-restock), Saans (voice ordering in Indic languages). All five share the `SwiggyClient`, three-gate pattern, and DPDP boilerplate from Last Bite. Detailed plan in [CLAUDE.md](https://github.com/Jayanth-reflex/swiggy-mcp/blob/main/CLAUDE.md).

**Ask.**
1. Whitelist `https://swiggy-mcp.vercel.app/api/oauth/callback` so the BYOC bridge can retire.
2. Builders Club admission so I can move Trail and Bharat Pantry off planning into shipping.
3. Any feedback on the gate flow or attribution posture before I open it to a wider beta.

Happy to demo live on a call. Best phone: [your number]. Built with Claude Code.

Thanks,
Jayanth Reddy
[your email]
[your LinkedIn / X]

---

## Follow-up cadence

- **Day 0:** Send. Post the same demo video on LinkedIn + tag Swiggy.
- **Day 7:** If no reply, post in [Builders Club Discord](https://mcp.swiggy.com/builders) (or wherever the public chat is) with a one-line "applied last week, here's the demo."
- **Day 14:** Polite nudge email. Keep the same thread. Add one new fact (a metric, a friend who tried it, etc.).
- **Day 21:** Stop nudging. Move on to Project 2 (Trail) — the application packet still wins them over when the next polished thing ships.

## Anti-patterns to avoid

- **Don't oversell the safety story.** They built the MCP — they know what it does. Mention the gates once, let the demo carry it.
- **Don't apologize for BYOC.** Frame it as the canonical CLAUDE.md path until whitelist clears.
- **Don't promise "100 users by next month."** They'll ask hard questions. Promise the gates work, not the user count.
- **Don't pitch all 5 projects.** Last Bite first. Mention the roadmap once at the end. Their attention is bounded.
