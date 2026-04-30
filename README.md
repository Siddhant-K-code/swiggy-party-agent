# swiggy-party-agent

Your team fills a Google Form. The agent reads it, builds a Swiggy cart, and waits. You confirm. The order is placed.

Built on [Swiggy Builders Club](https://mcp.swiggy.com/builders/) MCP + Vercel AI SDK + Anthropic.

---

## How it works

```
Google Form → CSV export → party-agent CLI → Swiggy MCP → Cart → Confirm → Order placed
```

1. Share a Google Form: name, dietary restrictions, cuisine preferences, spice level.
2. Team fills it in. Export responses as CSV from Google Sheets.
3. Run `party-agent --csv responses.csv`. The agent:
   - Resolves the office delivery address via `get_addresses`
   - Finds a restaurant that fits the group via `search_restaurants`
   - Picks a dish per person via `search_menu`
   - Builds the full cart in one `update_food_cart` call
   - Applies the best available COD coupon
4. CLI prints a per-person breakdown. You confirm.
5. Agent calls `place_food_order`.

The agent never places an order on its own. Cart building and order placement are separate steps.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     party-agent CLI                     │
│                      src/cli.ts                         │
└──────────────┬──────────────────────────────────────────┘
               │
       ┌───────▼────────┐         ┌──────────────────────┐
       │  CSV Parser    │         │   Swiggy Party Agent  │
       │  src/parser.ts │         │   src/agent.ts        │
       │                │         │                       │
       │ • Reads CSV    │         │ • Vercel AI SDK       │
       │ • Normalises   │         │ • Anthropic (config.) │
       │   diet tags    │         │ • Swiggy Food MCP     │
       │ • Splits into  │         │                       │
       │   cap groups   │         │                       │
       └───────┬────────┘         └──────────┬────────────┘
               │                             │
               └─────────────┬───────────────┘
                             │
               ┌─────────────▼───────────────┐
               │     Swiggy Food MCP Server   │
               │   https://mcp.swiggy.com/food│
               │                             │
               │  get_addresses              │
               │  search_restaurants         │
               │  get_restaurant_menu        │
               │  search_menu                │
               │  update_food_cart           │
               │  fetch_food_coupons         │
               │  apply_food_coupon          │
               │  get_food_cart              │
               │  place_food_order           │
               └─────────────────────────────┘
```

### Cart cap

Defaults to ₹5000 per order, configurable via `--cap`. Large teams are split into groups automatically — each group gets its own cart and confirmation prompt.

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
```

### Get a Swiggy access token

Swiggy MCP uses OAuth 2.1 with PKCE. Quickest path for testing:

1. Add Swiggy MCP to Claude Desktop via the [consumer config](https://mcp.swiggy.com/builders/docs/start/consumer/use-in-ai-client.md)
2. Complete the OAuth flow (phone + OTP)
3. Extract the token from Claude Desktop's MCP config, or run the PKCE flow directly via the [developer quickstart](https://mcp.swiggy.com/builders/docs/start/developer/index.md)

Tokens last 5 days. Re-run the OAuth flow when one expires.

---

## Usage

### 1. Create the Google Form

Use the template in [`examples/google-form-template.md`](./examples/google-form-template.md).

Fields: Name, Dietary Restrictions, Cuisine Preferences, Dish Preferences, Spice Level.

### 2. Export responses as CSV

In Google Sheets: **File → Download → Comma Separated Values (.csv)**

See [`examples/responses.csv`](./examples/responses.csv) for the expected format.

### 3. Run the agent

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

The CLI prints a per-person breakdown for each group:

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

## Project structure

```
swiggy-party-agent/
├── src/
│   ├── cli.ts        # Argument parsing, display, confirmation loop
│   ├── agent.ts      # Cart building and order placement via Swiggy MCP
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
