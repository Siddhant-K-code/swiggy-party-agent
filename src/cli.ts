#!/usr/bin/env node
/**
 * party-agent CLI
 *
 * Usage:
 *   npx party-agent --csv responses.csv --event "v2.0 Launch" --address "Office" --budget 250
 *
 * Flow:
 *   1. Parse CSV → team members
 *   2. Split into ₹1000-cap groups
 *   3. For each group: agent builds cart, presents summary
 *   4. Team lead confirms each group → agent places order
 *   5. Print order IDs + tracking info
 */

import { config } from "dotenv";
config();

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import chalk from "chalk";
import ora from "ora";
import inquirer from "inquirer";
import { loadPartyConfig, splitIntoGroups } from "./parser.js";
import { buildCartForGroup, placeOrder } from "./agent.js";
import type { OrderSummary } from "./types.js";

// ── CLI argument parsing (no external dep needed) ──────────────────────────

function parseArgs(): {
  csv: string;
  event: string;
  address: string;
  budget: number;
  cap: number;
} {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };

  const csv = get("--csv");
  const event = get("--event") ?? "Team Party";
  const address = get("--address") ?? "Office";
  const budgetRaw = get("--budget");
  const budget = budgetRaw ? parseInt(budgetRaw, 10) : 250;
  const capRaw = get("--cap");
  const cap = capRaw ? parseInt(capRaw, 10) : 5000;

  if (!csv) {
    console.error(chalk.red("Error: --csv <path> is required"));
    console.error(
      chalk.dim(
        "Usage: npx party-agent --csv responses.csv --event \"v2.0 Launch\" --address \"Office\" --budget 250 --cap 5000"
      )
    );
    process.exit(1);
  }

  const csvPath = resolve(csv);
  if (!existsSync(csvPath)) {
    console.error(chalk.red(`Error: CSV file not found: ${csvPath}`));
    process.exit(1);
  }

  return { csv: csvPath, event, address, budget, cap };
}

// ── Display helpers ────────────────────────────────────────────────────────

function printBanner(eventName: string, memberCount: number, groupCount: number, cap: number) {
  console.log();
  console.log(chalk.bold.cyan("  🎉 Swiggy Party Agent"));
  console.log(chalk.dim("  ─────────────────────────────────────────"));
  console.log(`  Event   : ${chalk.white(eventName)}`);
  console.log(`  Members : ${chalk.white(memberCount)}`);
  console.log(`  Orders  : ${chalk.white(groupCount)} (₹${cap} cap per order)`);
  console.log(chalk.dim("  ─────────────────────────────────────────"));
  console.log();
}

function printOrderSummary(summary: OrderSummary, cap: number) {
  console.log();
  console.log(
    chalk.bold(
      `  Order ${summary.groupIndex + 1} of ${summary.totalGroups} — ${summary.restaurantName}`
    )
  );
  console.log(chalk.dim("  ─────────────────────────────────────────"));

  const nameWidth = Math.max(...summary.items.map((i) => i.memberName.length), 10);

  for (const item of summary.items) {
    const name = item.memberName.padEnd(nameWidth);
    const dish = item.restaurantItem;
    const price = chalk.yellow(`₹${item.price}`);
    console.log(`  ${chalk.white(name)}  ${dish}  ${price}`);
  }

  console.log(chalk.dim("  ─────────────────────────────────────────"));

  const discount = summary.discount ?? 0;
  if (summary.couponCode && discount > 0) {
    console.log(
      `  Coupon  : ${chalk.green(summary.couponCode)}  ${chalk.green(`-₹${discount}`)}`
    );
  }

  const totalColor = summary.total > cap ? chalk.red : chalk.bold.green;
  console.log(`  Total   : ${totalColor(`₹${summary.total}`)}`);

  if (summary.total > cap) {
    console.log(
      chalk.red(`  ⚠ Total exceeds ₹${cap} cap. Agent will need to adjust.`)
    );
  }

  console.log();
}

async function confirmOrder(summary: OrderSummary): Promise<boolean> {
  const { confirm } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message: chalk.bold(
        `Place order ${summary.groupIndex + 1}/${summary.totalGroups} from ${summary.restaurantName} (₹${summary.total})?`
      ),
      default: false,
    },
  ]);
  return confirm;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const { csv, event, address, budget, cap } = parseArgs();

  // 1. Load and parse the CSV
  let config: ReturnType<typeof loadPartyConfig>;
  try {
    config = loadPartyConfig(csv, {
      eventName: event,
      deliveryAddressLabel: address,
      maxBudgetPerPerson: budget,
    });
  } catch (err: any) {
    console.error(chalk.red(`Failed to parse CSV: ${err.message}`));
    process.exit(1);
  }

  const groups = splitIntoGroups(config.members, config.maxBudgetPerPerson, cap);
  printBanner(event, config.members.length, groups.length, cap);

  if (config.members.length === 0) {
    console.error(chalk.red("No members found in CSV. Check the file format."));
    process.exit(1);
  }

  const placedOrders: { groupIndex: number; orderId: string; restaurant: string }[] = [];
  const skippedGroups: number[] = [];

  // 2. Process each group sequentially
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const spinner = ora(
      `Building cart for group ${i + 1}/${groups.length} (${group.map((m) => m.name).join(", ")})...`
    ).start();

    let summary: OrderSummary;
    try {
      summary = await buildCartForGroup(
        group,
        config.deliveryAddressLabel,
        config.maxBudgetPerPerson,
        i,
        groups.length,
        cap
      );
      spinner.succeed(
        `Cart ready: ${summary.restaurantName} — ₹${summary.total}`
      );
    } catch (err: any) {
      spinner.fail(`Failed to build cart for group ${i + 1}: ${err.message}`);
      skippedGroups.push(i + 1);
      continue;
    }

    // 3. Show summary and ask for confirmation
    printOrderSummary(summary, cap);
    const confirmed = await confirmOrder(summary);

    if (!confirmed) {
      console.log(chalk.dim(`  Skipped order ${i + 1}.`));
      skippedGroups.push(i + 1);
      continue;
    }

    // 4. Place the order
    const placeSpinner = ora(`Placing order ${i + 1}...`).start();
    try {
      const orderId = await placeOrder(summary, cap);
      placeSpinner.succeed(
        `Order placed! ID: ${chalk.bold.green(orderId)}`
      );
      placedOrders.push({
        groupIndex: i + 1,
        orderId,
        restaurant: summary.restaurantName,
      });
    } catch (err: any) {
      placeSpinner.fail(`Failed to place order ${i + 1}: ${err.message}`);
      skippedGroups.push(i + 1);
    }
  }

  // 5. Final summary
  console.log();
  console.log(chalk.bold.cyan("  ── Summary ──────────────────────────────"));

  if (placedOrders.length > 0) {
    console.log(chalk.green(`  ${placedOrders.length} order(s) placed:`));
    for (const o of placedOrders) {
      console.log(
        `    Group ${o.groupIndex}: ${o.restaurant} — Order ID ${chalk.bold(o.orderId)}`
      );
    }
    console.log();
    console.log(
      chalk.dim("  Track orders in the Swiggy app or at swiggy.com/order")
    );
  }

  if (skippedGroups.length > 0) {
    console.log(
      chalk.yellow(`  ${skippedGroups.length} group(s) skipped: ${skippedGroups.join(", ")}`)
    );
  }

  console.log();
}

main().catch((err) => {
  console.error(chalk.red(`Unexpected error: ${err.message}`));
  process.exit(1);
});
