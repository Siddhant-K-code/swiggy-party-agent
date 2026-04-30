/**
 * Swiggy Party Agent
 *
 * Uses the Vercel AI SDK with Anthropic + Swiggy Food MCP server to:
 *   1. Resolve the office delivery address
 *   2. Find a restaurant that fits the group's preferences
 *   3. Build a cart — one item per team member
 *   4. Apply the best available COD coupon
 *   5. Return a full OrderSummary for the team lead to confirm
 *
 * place_food_order is NOT called here. The CLI calls it after explicit confirmation.
 */

import { anthropic } from "@ai-sdk/anthropic";
import { experimental_createMCPClient as createMCPClient, generateText } from "ai";
import type { TeamMember, OrderSummary } from "./types.js";
import { buildGroupSummary } from "./parser.js";

const SWIGGY_FOOD_MCP_URL =
  process.env.SWIGGY_FOOD_MCP_URL ?? "https://mcp.swiggy.com/food";

// Any Anthropic model ID works here. Defaults to claude-opus-4-5 but can be
// overridden via ANTHROPIC_MODEL — e.g. claude-3-5-haiku-20241022 for lower cost.
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-5";

function buildSystemPrompt(): string {
  return `You are a food ordering agent for corporate team parties on Swiggy.

Your job for each group:
1. Call get_addresses to find the delivery address matching the label provided.
2. Call search_restaurants with that addressId and a query based on the group's cuisine preferences.
   - Only consider restaurants with availabilityStatus "OPEN".
   - Prefer restaurants that can serve BOTH vegetarian and non-vegetarian if the group is mixed.
   - Pick the highest-rated restaurant that fits the group's dietary needs.
3. Call get_restaurant_menu or search_menu to find dishes for each member.
   - Match each member's cuisine/dish preferences.
   - Respect dietary restrictions strictly (vegetarian members must get veg items, no-peanuts means no peanut dishes, etc.).
   - Stay within the per-person budget.
4. Call update_food_cart with ALL items in a single call.
5. Call fetch_food_coupons and apply the best COD-compatible coupon via apply_food_coupon.
6. Call get_food_cart to get the final cart state.
7. Return a structured JSON summary (see format below).

CRITICAL RULES:
- NEVER call place_food_order. Cart building only.
- Cart total must NOT exceed the cap provided in the user prompt.
- Only COD payment — filter out coupons that require online payment.
- If a member has "vegetarian", "vegan", or "jain" restriction, their item MUST be marked veg.
- If no single restaurant fits all members, pick the one that fits the most members and note exceptions.

After building the cart, respond with ONLY this JSON (no markdown, no explanation):
{
  "restaurantName": "string",
  "restaurantId": "string",
  "addressId": "string",
  "items": [
    {
      "memberName": "string",
      "dish": "string",
      "restaurantItem": "string",
      "itemId": "string",
      "quantity": 1,
      "price": number
    }
  ],
  "subtotal": number,
  "couponCode": "string or null",
  "discount": number,
  "total": number
}`;
}

function buildUserPrompt(
  members: TeamMember[],
  addressLabel: string,
  maxBudgetPerPerson: number,
  groupIndex: number,
  totalGroups: number,
  cartCap: number
): string {
  const summary = buildGroupSummary(members);
  const memberDetails = members
    .map((m) => {
      const parts = [`- ${m.name}`];
      if (m.dietaryRestrictions.length > 0) {
        parts.push(`  Restrictions: ${m.dietaryRestrictions.join(", ")}`);
      }
      if (m.cuisinePreferences.length > 0) {
        parts.push(`  Cuisine: ${m.cuisinePreferences.join(", ")}`);
      }
      if (m.dishPreferences.length > 0) {
        parts.push(`  Dishes: ${m.dishPreferences.join(", ")}`);
      }
      if (m.spiceLevel !== "any") {
        parts.push(`  Spice: ${m.spiceLevel}`);
      }
      return parts.join("\n");
    })
    .join("\n");

  return `Build a Swiggy cart for group ${groupIndex + 1} of ${totalGroups}.

Delivery address label: "${addressLabel}"
Budget per person: ₹${maxBudgetPerPerson} (hard cap: ₹${cartCap} total for this group)

${summary}

Member details:
${memberDetails}

Build the cart now. Return only the JSON summary.`;
}

export async function buildCartForGroup(
  members: TeamMember[],
  addressLabel: string,
  maxBudgetPerPerson: number,
  groupIndex: number,
  totalGroups: number,
  cartCap: number = 5000
): Promise<OrderSummary> {
  const token = process.env.SWIGGY_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "SWIGGY_ACCESS_TOKEN is not set. See .env.example for setup instructions."
    );
  }

  // Connect to Swiggy Food MCP server via streamable HTTP
  const mcpClient = await createMCPClient({
    transport: {
      type: "sse",
      url: SWIGGY_FOOD_MCP_URL,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    } as any,
  });

  try {
    const tools = await mcpClient.tools();

    const { text } = await generateText({
      model: anthropic(MODEL),
      tools,
      maxSteps: 20, // enough for the full flow: addresses → search → menu → cart → coupon → get_cart
      system: buildSystemPrompt(),
      prompt: buildUserPrompt(
        members,
        addressLabel,
        maxBudgetPerPerson,
        groupIndex,
        totalGroups,
        cartCap
      ),
    });

    // Extract JSON from the final response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`Agent did not return valid JSON.\n\nRaw response:\n${text}`);
    }

    const result = JSON.parse(jsonMatch[0]);

    return {
      ...result,
      groupIndex,
      totalGroups,
      couponCode: result.couponCode ?? undefined,
      discount: result.discount ?? 0,
    } as OrderSummary;
  } finally {
    await mcpClient.close();
  }
}

// Place a confirmed order. Called only after explicit team lead confirmation.
// Handles the check-then-retry pattern for non-idempotent place_food_order.
export async function placeOrder(summary: OrderSummary, cartCap: number = 5000): Promise<string> {
  const token = process.env.SWIGGY_ACCESS_TOKEN;
  if (!token) {
    throw new Error("SWIGGY_ACCESS_TOKEN is not set.");
  }

  const mcpClient = await createMCPClient({
    transport: {
      type: "sse",
      url: SWIGGY_FOOD_MCP_URL,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    } as any,
  });

  try {
    const tools = await mcpClient.tools();

    const { text } = await generateText({
      model: anthropic(MODEL),
      tools,
      maxSteps: 5,
      system: `You are placing a confirmed Swiggy food order.
The cart is already built. Your only job:
1. Call get_food_cart to verify the cart is still intact.
2. If the cart total exceeds ₹${cartCap}, respond with ERROR: cart_cap_exceeded.
3. Call place_food_order with paymentMethod "COD".
4. If place_food_order returns 5xx or network error, call get_food_orders to check if the order went through before retrying.
5. Return ONLY the orderId as plain text, nothing else.`,
      prompt: `Place the order now. Expected restaurant: ${summary.restaurantName}, expected total: ₹${summary.total}. Return only the orderId.`,
    });

    const orderId = text.trim();
    if (orderId.startsWith("ERROR:")) {
      throw new Error(orderId);
    }

    return orderId;
  } finally {
    await mcpClient.close();
  }
}
