# Last Bite — Demo Video Script

**Length target:** 90 seconds
**Aspect:** 16:9 horizontal (LinkedIn / X / Builders Club submission). Re-cut a 9:16 vertical for Reels later.
**Tone:** Calm, confident, slightly self-deprecating about COD-only design choice. Don't over-pitch.

**Tools:**
- Recording: macOS Screenshot (Cmd+Shift+5) or QuickTime
- Mic: built-in is fine. Quiet room. One take.
- Editing: iMovie / DaVinci Resolve (free)
- Captions: open-source `auto-subtitle` or just hand-type — keep them; LinkedIn auto-mutes

**Setup before recording:**
1. Browser at full screen, dark mode off (the redesign reads better on light).
2. Tabs closed except `swiggy-mcp.vercel.app/connect`.
3. Have your bearer token in clipboard before hitting record.
4. Open `claude_desktop_config.json` in another window for the BYOC step.
5. **Mode = Demo** (no real ₹ on the line).

---

## Shot list + voiceover

### [0:00 — 0:05]  Hook
**Shot:** Landing page hero, full screen.
**VO:** *"You know that moment at midnight when you order biryani you don't actually want?"*
**B-roll:** None — let the headline sit.

### [0:05 — 0:12]  Pitch
**Shot:** Slow scroll past hero into the chat preview mockup.
**VO:** *"Last Bite is a web agent for Swiggy that takes plain English, walks you through three confirmations, and waits 30 seconds before placing the order."*
**On-screen:** No overlay needed — the chat preview tells the story.

### [0:12 — 0:25]  Connect
**Shot:** Cut to /connect. Quick split-screen with `claude_desktop_config.json` showing the swiggy-food entry, then back to /connect.
**VO:** *"Setup once. Authorize Swiggy MCP inside Claude Desktop, copy your bearer token, paste it here. Until Swiggy whitelists our redirect URI — open issue, link in description — every user supplies their own token. Encrypted at rest with AES-256."*
**Action:** Paste token into the textarea. Hit "Connect token". Get the success page.
**On-screen lower-third:** *"BYOC = Bring Your Own Claude. Token never leaves Upstash, AES-256 sealed."*

### [0:25 — 0:55]  The order — the core scene
**Shot:** /order/new. Type slowly so viewers can read.
**VO:** *"Now I just type what I want."*
**Type:** `biryani at Paradise, ₹500`
**Beat:** Watch the agent reply with the cart.
**VO over the reply:** *"It picks the best match in real time, builds the cart from Swiggy's menu, and shows you the calorie damage."*
**Action — Gate 1:** Reply `yes`.
**VO:** *"Calorie gate."*
**Action — Gate 2:** Reply `yes`.
**VO:** *"ETA gate."*
**Action — Gate 3:** Reply `yes`.
**VO over the 30s timer:** *"And then a 30-second grace timer with a STOP escape hatch — because Swiggy's MCP orders cannot be cancelled after they fire. We'd rather waste your time than your ₹500."*
**Beat:** Wait the timer out. Demo confirmation appears.

### [0:55 — 1:10]  The smart bit
**Shot:** Back at /order/new. Type something with constraints.
**Type:** `chocolate ice cream within 7km of MyHome, best rated, under ₹300`
**VO:** *"It understands budgets, distance, ratings, your saved addresses — even Hinglish. If it can't find an exact match, it shows you the near-misses with reasons. Pick a number and it builds the cart there."*
**Show:** The recommendations list (or a successful match).

### [1:10 — 1:20]  Stack
**Shot:** Quick cuts of code: `lib/agent/graph.ts` (the LangGraph), `lib/agent/intent.ts` (the Zod schema), `app/api/chat/route.ts` (the handler).
**VO:** *"Built on Next.js, LangGraph, the Vercel AI SDK and Swiggy's MCP server. Groq Llama 3.1 for intent extraction, deterministic TypeScript for filtering — no agentic LLM tool loops."*

### [1:20 — 1:30]  Close
**Shot:** Landing page footer with "Powered by Swiggy" pill.
**VO:** *"This is Project 1 of 5 on Swiggy MCP. Code in the description. Powered by Swiggy."*
**On-screen lower-third:**
- `swiggy-mcp.vercel.app`
- `github.com/Jayanth-reflex/lastbite-swiggy-mcp`

---

## Common mistakes to avoid

1. **Don't switch to Live mode for the demo.** Demo is enough to show the flow. Live = real money. (Lost ₹321 once. Don't repeat.)
2. **Don't speed up the gates.** The whole point is the gates *feel* deliberate. Let the viewer see the prompt and your YES.
3. **Don't read the cart total out loud** — the on-screen text does it. Talking over redundant info reads as "infomercial".
4. **Don't apologize for BYOC.** Frame it as a security feature ("token never leaves your account scope") rather than a workaround.
5. **End on the orange dot.** The brand mark + "Powered by Swiggy" is the cleanest close.

## Exports

- `last-bite-demo-90s.mp4` — main cut for LinkedIn / Builders Club
- `last-bite-demo-30s.mp4` — chop the connect + first order only, for X
- `last-bite-demo-vertical-60s.mp4` — re-edit for Reels / Shorts
- Thumbnail: hero screenshot with "Order Swiggy in plain English" overlay
