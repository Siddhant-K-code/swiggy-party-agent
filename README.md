# swiggy-party-agent

An AI agent for corporate team food orders. The team fills a Google Form, the agent reads the responses and builds a Swiggy cart, the team lead confirms and places the order.

Built on [Swiggy Builders Club](https://mcp.swiggy.com/builders/) MCP + Vercel AI SDK + Anthropic.

---

## How it works

```
Google Form → CSV export → party-agent CLI → Swiggy MCP → Cart → Team lead confirms → Order placed
```

1. Team lead shares a Google Form (name, dietary restrictions, cuisine/dish preferences, spice level)
2. Team fills it in. Export responses as CSV from Google Sheets.
3. Run `party-agent --csv responses.csv`. The agent:
   - Resolves the office delivery address via `get_addresses`
   - Finds a restaurant that fits the group's dietary mix via `search_restaurants`
   - Picks a dish per person via `search_menu`
   - Builds the full cart in one `update_food_cart` call
   - Applies the best available COD coupon
4. CLI prints a per-person order summary. Team lead confirms.
5. Agent calls `place_food_order`. Done.

The agent never places an order without explicit confirmation. Cart building and order placement are separate steps.

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
       │ • Normalises   │         │ • Anthropic claude-   │
       │   diet tags    │         │   opus-4-5            │
       │ • Splits into  │         │ • Connects to Swiggy  │
       │   ₹1000 groups │         │   Food MCP server     │
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

### The cart cap

The cart cap defaults to ₹5000 per order and is configurable via `--cap`. The agent automatically splits large teams into groups sized to fit within the cap based on your `--budget` per person. Each group gets its own cart and confirmation prompt.

Swiggy Builders Club v1 enforces a ₹1000 hard cap on sandbox accounts. Pass `--cap 1000` if you're on a sandbox `client_id`. Production `client_id`s have no enforced cap.

---

## Setup

### Prerequisites

- Node.js 20+
- An [Anthropic API key](https://console.anthropic.com/)
- A Swiggy account with a saved "Office" address
- Swiggy Builders Club access token ([apply here](https://mcp.swiggy.com/builders/docs/operate/access.md), or use the [consumer quickstart](https://mcp.swiggy.com/builders/docs/start/consumer/use-in-ai-client.md) to get a token via Claude Desktop)

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

Swiggy MCP uses OAuth 2.1 with PKCE. The quickest way to get a token for testing:

1. Add Swiggy MCP to Claude Desktop using the [consumer config](https://mcp.swiggy.com/builders/docs/start/consumer/use-in-ai-client.md)
2. Complete the OAuth flow (phone + OTP)
3. Extract the token from Claude Desktop's MCP config or use the [developer quickstart](https://mcp.swiggy.com/builders/docs/start/developer/index.md) to run the PKCE flow directly

Token lifetime: 5 days. Re-run the OAuth flow when it expires.

---

## Usage

### 1. Create the Google Form

Use the template in [`examples/google-form-template.md`](./examples/google-form-template.md).

Fields: Name, Dietary Restrictions, Cuisine Preferences, Dish Preferences, Spice Level.

### 2. Export responses as CSV

In Google Sheets: **File → Download → Comma Separated Values (.csv)**

Save as `responses.csv`. See [`examples/responses.csv`](./examples/responses.csv) for the expected format.

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
| `--cap` | `5000` | Max cart total per order in INR. Swiggy Builders Club v1 enforces ₹1000; raise this once you have a production `client_id` with no cap. |

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

Type `y` to place. Type `n` to skip that group.

---

## Project structure

```
swiggy-party-agent/
├── src/
│   ├── cli.ts        # CLI entrypoint — argument parsing, display, confirmation loop
│   ├── agent.ts      # Swiggy MCP agent — cart building and order placement
│   ├── parser.ts     # CSV parser — Google Form responses → TeamMember[]
│   └── types.ts      # Shared types
├── examples/
│   ├── responses.csv              # Sample 12-person team CSV
│   └── google-form-template.md   # Copy-paste form structure
├── .env.example
├── package.json
└── tsconfig.json
```

---

## Dietary restriction handling

The parser normalises free-text dietary entries to canonical tags:

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

The agent prompt enforces these strictly: a member tagged `vegetarian` will only receive items marked veg in Swiggy's menu.

---

## Limitations

- **Cart cap**: Defaults to ₹5000 per order. Pass `--cap 1000` if your Swiggy Builders Club plan enforces the v1 limit. Large teams are split into groups automatically.
- **COD only**: Swiggy MCP v1 supports Cash on Delivery only. Online payment coupons are filtered out.
- **Single restaurant per group**: Each ₹1000 cart is tied to one restaurant. The agent picks the best fit for the group.
- **Token expiry**: Swiggy access tokens last 5 days. No automatic refresh in v1 — re-run OAuth when expired.
- **India only**: Swiggy operates in India. Addresses must be in a Swiggy-serviceable city.

---

## Built with

- [Swiggy Builders Club](https://mcp.swiggy.com/builders/) — Food MCP server (35 tools across Food, Instamart, Dineout)
- [Vercel AI SDK](https://sdk.vercel.ai/) — MCP client + `generateText` with tool use
- [Anthropic Claude](https://anthropic.com/) — model configurable via `ANTHROPIC_MODEL` env var, defaults to `claude-opus-4-5`
- [csv-parse](https://csv.js.org/parse/) — CSV parsing
- [inquirer](https://github.com/SBoudrias/Inquirer.js) — interactive confirmation prompts

---

## Author

Siddhant Khare ([@Siddhant_K_code](https://twitter.com/Siddhant_K_code))
