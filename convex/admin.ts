/* eslint-disable @typescript-eslint/no-explicit-any */

import { v } from "convex/values";
import { action, internalMutation } from "./_generated/server";
import { makeFunctionReference } from "convex/server";

const wipeTableValidator = v.union(
  v.literal("sources"),
  v.literal("signals"),
  v.literal("events"),
  v.literal("ingestRuns"),
  v.literal("notifications"),
  v.literal("alerts"),
);

type WipeTable =
  | "sources"
  | "signals"
  | "events"
  | "ingestRuns"
  | "notifications"
  | "alerts";

const adapterRunValidator = v.object({
  sourceName: v.string(),
  itemsIn: v.number(),
  itemsOut: v.number(),
  warnings: v.array(v.string()),
});

const purgeTableBatchRef = makeFunctionReference(
  "admin:purgeTableBatch",
) as any;
const runAllIngestionRef = makeFunctionReference(
  "ingest:runAllIngestion",
) as any;
const ingestSocialRef = makeFunctionReference(
  "ingest:ingestSocial",
) as any;

export const purgeTableBatch = internalMutation({
  args: {
    table: wipeTableValidator,
    limit: v.optional(v.number()),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const limitRaw = args.limit ?? 128;
    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(256, Math.round(limitRaw)))
      : 128;

    if (args.table === "sources") {
      const rows = await ctx.db.query("sources").take(limit);
      await Promise.all(rows.map((row: any) => ctx.db.delete(row._id)));
      return rows.length;
    }
    if (args.table === "signals") {
      const rows = await ctx.db.query("signals").take(limit);
      await Promise.all(rows.map((row: any) => ctx.db.delete(row._id)));
      return rows.length;
    }
    if (args.table === "events") {
      const rows = await ctx.db.query("events").take(limit);
      await Promise.all(rows.map((row: any) => ctx.db.delete(row._id)));
      return rows.length;
    }
    if (args.table === "ingestRuns") {
      const rows = await ctx.db.query("ingestRuns").take(limit);
      await Promise.all(rows.map((row: any) => ctx.db.delete(row._id)));
      return rows.length;
    }
    if (args.table === "notifications") {
      const rows = await ctx.db.query("notifications").take(limit);
      await Promise.all(rows.map((row: any) => ctx.db.delete(row._id)));
      return rows.length;
    }

    const rows = await ctx.db.query("alerts").take(limit);
    await Promise.all(rows.map((row: any) => ctx.db.delete(row._id)));
    return rows.length;
  },
});

async function purgeTableCompletely(
  ctx: any,
  table: WipeTable,
  batchSize = 128,
): Promise<number> {
  let deleted = 0;

  while (true) {
    const count: number = await ctx.runMutation(purgeTableBatchRef, {
      table,
      limit: batchSize,
    });

    deleted += count;
    if (count < batchSize) {
      break;
    }
  }

  return deleted;
}

export const wipeOldDataAndReingest = action({
  args: {
    confirm: v.string(),
    purgeAlerts: v.optional(v.boolean()),
    includeSocial: v.optional(v.boolean()),
  },
  returns: v.object({
    startedAt: v.number(),
    finishedAt: v.number(),
    deleted: v.object({
      sources: v.number(),
      signals: v.number(),
      events: v.number(),
      ingestRuns: v.number(),
      notifications: v.number(),
      alerts: v.number(),
    }),
    runs: v.array(adapterRunValidator),
  }),
  handler: async (ctx, args) => {
    if (args.confirm !== "WIPE_AND_REINGEST") {
      throw new Error("Confirmation string mismatch. Pass confirm='WIPE_AND_REINGEST'.");
    }

    const startedAt = Date.now();
    const deleted = {
      sources: 0,
      signals: 0,
      events: 0,
      ingestRuns: 0,
      notifications: 0,
      alerts: 0,
    };

    deleted.sources = await purgeTableCompletely(ctx, "sources");
    deleted.signals = await purgeTableCompletely(ctx, "signals");
    deleted.events = await purgeTableCompletely(ctx, "events");
    deleted.ingestRuns = await purgeTableCompletely(ctx, "ingestRuns");
    deleted.notifications = await purgeTableCompletely(ctx, "notifications");

    if (args.purgeAlerts) {
      deleted.alerts = await purgeTableCompletely(ctx, "alerts");
    }

    const baseRun = await ctx.runAction(runAllIngestionRef, {});
    const runs = [...baseRun.runs];

    const socialEnabled = (process.env.ENABLE_SOCIAL_INGESTION ?? "false") === "true";
    if (args.includeSocial && !socialEnabled) {
      runs.push(await ctx.runAction(ingestSocialRef, {}));
    }

    return {
      startedAt,
      finishedAt: Date.now(),
      deleted,
      runs,
    };
  },
});
