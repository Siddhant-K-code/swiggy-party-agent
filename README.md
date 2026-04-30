# swiggy-party-agent

Your team fills a Google Form. The agent reads it, builds a Swiggy cart, and waits. You confirm. The order is placed.

Built on [Swiggy Builders Club](https://mcp.swiggy.com/builders/) MCP + Vercel AI SDK + Anthropic.

---

## How it works

```
Google Form → CSV export → party-agent → Swiggy MCP → Cart → Confirm → Order placed
```

1. Share a Google Form: name, dietary restrictions, cuisine preferences, spice level.
2. Team fills it in. Export responses as CSV from Google Sheets.
3. Run the agent (CLI, Slack bot, web app, or MCP server — pick your surface). The agent:
   - Resolves the office delivery address via `get_addresses`
   - Finds a restaurant that fits the group via `search_restaurants`
   - Picks a dish per person via `search_menu`
   - Builds the full cart in one `update_food_cart` call
   - Applies the best available COD coupon
4. The agent presents a per-person breakdown. You confirm.
5. Agent calls `place_food_order`.

The agent never places an order on its own. Cart building and order placement are separate steps.

---

## Integration surfaces

The core agent logic lives in `src/agent.ts` and is surface-agnostic. The same `buildCartForGroup` and `placeOrder` functions work across every integration below.

### CLI (included)

Run it from a terminal. Best for one-off events or testing.

```bash
npm run dev -- --csv responses.csv --event "v2.0 Launch" --address "Office" --budget 250
```

### Slack bot

Wire the agent to a Slack slash command or workflow. The team lead runs `/party-order` in the team channel, the bot posts the cart summary as a message with Approve / Skip buttons, and calls `placeOrder` on approval.

```
/party-order event="v2.0 Launch" csv=<Google Sheets URL>
```

Suggested stack: Slack Bolt (Node.js) + Block Kit for the confirmation UI. The agent reads the sheet via Google Sheets API instead of a local CSV export.

### Web app

A Next.js app where the team lead pastes a Google Sheets link, reviews the AI-built cart in a table UI, edits individual items if needed, and clicks Place Order. Each team member's row is editable before confirmation.

Suggested stack: Next.js + Tailwind + Swiggy MCP on the server side.

### MCP server (expose as a tool)

Expose `buildPartyCart` and `placePartyOrder` as MCP tools so any MCP-compatible AI client (Claude Desktop, Cursor, etc.) can trigger a team order from a conversation.

```
User: "Order lunch for the team. Here's the sheet: <url>"
Agent: [calls buildPartyCart tool] → presents summary → [calls placePartyOrder on confirmation]
```

Suggested stack: `@modelcontextprotocol/sdk` server, two tools, same agent logic underneath.

### Scheduled (cron)

Run every Friday at noon. Pull the latest sheet responses, build the cart, post the summary to Slack for approval. If no one rejects within 30 minutes, place the order automatically.

Suggested stack: GitHub Actions cron + Slack incoming webhook for the approval window.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        Integration Surface                        │
│         CLI  │  Slack Bot  │  Web App  │  MCP Server  │  Cron    │
└──────────────────────────────┬───────────────────────────────────┘
                               │
               ┌───────────────▼───────────────┐
               │          src/agent.ts          │
               │                               │
               │  buildCartForGroup()           │
               │  placeOrder()                 │
               └───────────────┬───────────────┘
                               │
       ┌───────────────────────┼───────────────────────┐
       │                       │                       │
┌──────▼──────┐        ┌───────▼───────┐     ┌────────▼────────┐
│ src/parser  │        │  Vercel AI SDK │     │  Swiggy Food    │
│             │        │  + Anthropic   │     │  MCP Server     │
│ CSV / Sheets│        │  (any model)   │     │                 │
│ → TeamMember│        │                │     │ get_addresses   │
│ []          │        │                │     │ search_*        │
└─────────────┘        └───────────────┘     │ update_cart     │
                                             │ place_order     │
                                             └─────────────────┘
```

### Cart cap

Defaults to ₹5000 per order, configurable via `--cap` (CLI) or the `cartCap` parameter (programmatic). Large teams split into groups automatically — each group gets its own cart and confirmation step.

Swiggy Builders Club v1 sandbox accounts have a ₹1000 hard cap. Pass `--cap 1000` if you're on a sandbox `client_id`.

---

## Setup

### Prerequisites

- Node.js 20+
- [Anthropic API key](https://console.anthropic.com/)
- Swiggy account with a saved delivery address labelled "Office"
- Swiggy Builders Club access token ([apply](https://mcp.swiggy.com/builders/docs/operate/access.md), or get one via the [consumer quickstart](https://mcp.swiggy.com/builders/docs/start/consumer/use-in-ai-client.md))

### Install

```bash
git clone https://github.com/Siddhant-K-code/swiggy-party-agent.git
cd swiggy-party-agent
npm install
```

### Configure

```bash
cp .env.example .env
```

Edit `.env`:

```bash
ANTHROPIC_API_KEY=sk-ant-...
SWIGGY_ACCESS_TOKEN=eyJhbGci...   # from Swiggy OAuth flow

# Optional — any Anthropic model ID. Defaults to claude-opus-4-5.
# ANTHROPIC_MODEL=claude-3-5-haiku-20241022
```

### Get a Swiggy access token

Swiggy MCP uses OAuth 2.1 with PKCE. Quickest path for testing:

1. Add Swiggy MCP to Claude Desktop via the [consumer config](https://mcp.swiggy.com/builders/docs/start/consumer/use-in-ai-client.md)
2. Complete the OAuth flow (phone + OTP)
3. Extract the token from Claude Desktop's MCP config, or run the PKCE flow directly via the [developer quickstart](https://mcp.swiggy.com/builders/docs/start/developer/index.md)

Tokens last 5 days. Re-run the OAuth flow when one expires.

---

## CLI usage

### 1. Create the Google Form

Use the template in [`examples/google-form-template.md`](./examples/google-form-template.md).

Fields: Name, Dietary Restrictions, Cuisine Preferences, Dish Preferences, Spice Level.

### 2. Export responses as CSV

In Google Sheets: **File → Download → Comma Separated Values (.csv)**

See [`examples/responses.csv`](./examples/responses.csv) for the expected format.

### 3. Run

```bash
npm run dev -- --csv responses.csv --event "v2.0 Launch Party" --address "Office" --budget 250
```

Or after building:

```bash
npm run build
node dist/cli.js --csv responses.csv --event "v2.0 Launch Party" --address "Office" --budget 250
```

**Options:**

| Flag | Default | Description |
|------|---------|-------------|
| `--csv` | *(required)* | Path to the exported Google Form CSV |
| `--event` | `"Team Party"` | Event name shown in the summary |
| `--address` | `"Office"` | Label of the saved Swiggy delivery address |
| `--budget` | `250` | Max spend per person in INR (used to size groups) |
| `--cap` | `5000` | Max cart total per order in INR |

### 4. Confirm and place

```
  Order 1 of 2 — Biryani House
  ─────────────────────────────────────────
  Rahul Sharma      Chicken Biryani (Half)  ₹249
  Ankit Gupta       Chicken Fried Rice      ₹199
  Vikram Singh      Butter Chicken + Naan   ₹329
  ─────────────────────────────────────────
  Coupon  : LAUNCH20  -₹50
  Total   : ₹727

? Place order 1/2 from Biryani House (₹727)? (y/N)
```

`y` places the order. `n` skips that group.

---

## Programmatic usage

Import the agent directly to build any integration:

```ts
import { buildCartForGroup, placeOrder } from "./src/agent.js";
import { parseCSV, splitIntoGroups } from "./src/parser.js";

const members = parseCSV("responses.csv");
const groups = splitIntoGroups(members, 250, 5000);

for (let i = 0; i < groups.length; i++) {
  const summary = await buildCartForGroup(
    groups[i], "Office", 250, i, groups.length, 5000
  );

  // present summary via your surface (Slack, web, etc.)
  // then on confirmation:
  const orderId = await placeOrder(summary, 5000);
}
```

---

## Project structure

```
swiggy-party-agent/
├── src/
│   ├── cli.ts        # CLI entrypoint
│   ├── agent.ts      # buildCartForGroup(), placeOrder() — surface-agnostic
│   ├── parser.ts     # Google Form CSV → TeamMember[]
│   └── types.ts      # Shared types
├── examples/
│   ├── responses.csv              # Sample 12-person team CSV
│   └── google-form-template.md   # Copy-paste form structure
├── .env.example
├── package.json
└── tsconfig.json
```

---

## Dietary restrictions

The parser normalises free-text entries to canonical tags:

| Input | Tag |
|-------|-----|
| Vegetarian, Veg | `vegetarian` |
| Vegan | `vegan` |
| Jain | `jain` |
| Halal | `halal` |
| Gluten free, Gluten-free | `gluten-free` |
| No peanuts, Peanut allergy | `no-peanuts` |
| No dairy, Lactose | `no-dairy` |
| Eggetarian | `eggetarian` |

Tags are enforced in the agent prompt. A member tagged `vegetarian` only receives veg items.

---

## Limitations

- **COD only**: Swiggy MCP v1 supports Cash on Delivery. Online payment coupons are filtered out.
- **Single restaurant per group**: Each cart is tied to one restaurant. The agent picks the best fit.
- **Token expiry**: Access tokens last 5 days. No automatic refresh in v1.
- **India only**: Addresses must be in a Swiggy-serviceable city.

---

## Built with

- [Swiggy Builders Club](https://mcp.swiggy.com/builders/) — Food MCP server
- [Vercel AI SDK](https://sdk.vercel.ai/) — MCP client + `generateText` with tool use
- [Anthropic Claude](https://anthropic.com/) — configurable via `ANTHROPIC_MODEL`, defaults to `claude-opus-4-5`
- [csv-parse](https://csv.js.org/parse/) — CSV parsing
- [inquirer](https://github.com/SBoudrias/Inquirer.js) — confirmation prompts

---

## Author

Siddhant Khare ([@Siddhant_K_code](https://twitter.com/Siddhant_K_code))
