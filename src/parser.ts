/**
 * Parses Google Form responses (exported as CSV) into a structured TeamMember list.
 *
 * Expected CSV columns (case-insensitive, order-independent):
 *   Name, Dietary Restrictions, Cuisine Preferences, Dish Preferences, Spice Level
 *
 * Google Sheets export: File → Download → CSV
 */

import { parse } from "csv-parse/sync";
import { readFileSync } from "fs";
import type { TeamMember, PartyConfig } from "./types.js";

// Normalise a free-text dietary restriction to a canonical tag
function normaliseDiet(raw: string): string {
  const s = raw.toLowerCase().trim();
  if (s.includes("vegan")) return "vegan";
  if (s.includes("vegetarian") || s === "veg") return "vegetarian";
  if (s.includes("jain")) return "jain";
  if (s.includes("halal")) return "halal";
  if (s.includes("gluten")) return "gluten-free";
  if (s.includes("peanut")) return "no-peanuts";
  if (s.includes("dairy") || s.includes("lactose")) return "no-dairy";
  if (s.includes("egg") || s.includes("eggetarian")) return "eggetarian";
  if (s === "none" || s === "no restrictions" || s === "") return "";
  return s; // keep unknown tags as-is
}

function normaliseSpice(raw: string): TeamMember["spiceLevel"] {
  const s = raw.toLowerCase().trim();
  if (s.includes("mild") || s.includes("low")) return "mild";
  if (s.includes("medium") || s.includes("moderate")) return "medium";
  if (s.includes("spicy") || s.includes("hot") || s.includes("high")) return "spicy";
  return "any";
}

function splitAndClean(value: string): string[] {
  return value
    .split(/[,;/]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// Find a column value case-insensitively
function col(row: Record<string, string>, ...keys: string[]): string {
  for (const key of keys) {
    const match = Object.keys(row).find(
      (k) => k.toLowerCase().trim() === key.toLowerCase()
    );
    if (match && row[match]?.trim()) return row[match].trim();
  }
  return "";
}

export function parseCSV(filePath: string): TeamMember[] {
  const raw = readFileSync(filePath, "utf-8");
  const rows: Record<string, string>[] = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  return rows.map((row) => {
    const dietRaw = col(row, "dietary restrictions", "dietary", "diet", "restrictions");
    const cuisineRaw = col(row, "cuisine preferences", "cuisine", "preferred cuisine");
    const dishRaw = col(row, "dish preferences", "dish", "preferred dish", "food preference");
    const spiceRaw = col(row, "spice level", "spice", "spice preference");

    const dietTags = splitAndClean(dietRaw)
      .map(normaliseDiet)
      .filter(Boolean);

    return {
      name: col(row, "name", "full name", "your name") || "Unknown",
      dietaryRestrictions: dietTags,
      cuisinePreferences: splitAndClean(cuisineRaw),
      dishPreferences: splitAndClean(dishRaw),
      spiceLevel: normaliseSpice(spiceRaw),
    };
  });
}

// Build a human-readable summary of the group's constraints for the agent prompt
export function buildGroupSummary(members: TeamMember[]): string {
  const allDiets = [...new Set(members.flatMap((m) => m.dietaryRestrictions))];
  const allCuisines = [...new Set(members.flatMap((m) => m.cuisinePreferences))];
  const allDishes = [...new Set(members.flatMap((m) => m.dishPreferences))];

  const hasVeg = allDiets.includes("vegetarian") || allDiets.includes("vegan") || allDiets.includes("jain");
  const hasNonVeg = members.some(
    (m) => !m.dietaryRestrictions.includes("vegetarian") &&
           !m.dietaryRestrictions.includes("vegan") &&
           !m.dietaryRestrictions.includes("jain")
  );

  const lines: string[] = [
    `Group of ${members.length} people:`,
    `  Members: ${members.map((m) => m.name).join(", ")}`,
  ];

  if (allDiets.length > 0) {
    lines.push(`  Dietary restrictions: ${allDiets.join(", ")}`);
  }
  if (hasVeg && hasNonVeg) {
    lines.push("  Mixed group: needs both vegetarian AND non-vegetarian options");
  } else if (hasVeg) {
    lines.push("  All vegetarian/vegan — restaurant must have strong veg menu");
  }
  if (allCuisines.length > 0) {
    lines.push(`  Cuisine preferences: ${allCuisines.join(", ")}`);
  }
  if (allDishes.length > 0) {
    lines.push(`  Dish preferences: ${allDishes.join(", ")}`);
  }

  return lines.join("\n");
}

// Split members into groups that fit within the cart cap.
// cartCap defaults to 5000; pass a lower value if your Swiggy plan enforces one.
export function splitIntoGroups(
  members: TeamMember[],
  maxBudgetPerPerson: number,
  cartCap: number = 5000
): TeamMember[][] {
  const membersPerGroup = Math.max(1, Math.floor(cartCap / maxBudgetPerPerson));
  const groups: TeamMember[][] = [];

  for (let i = 0; i < members.length; i += membersPerGroup) {
    groups.push(members.slice(i, i + membersPerGroup));
  }

  return groups;
}

export function loadPartyConfig(csvPath: string, options: {
  eventName: string;
  deliveryAddressLabel: string;
  maxBudgetPerPerson: number;
}): PartyConfig {
  const members = parseCSV(csvPath);
  return {
    ...options,
    members,
  };
}
