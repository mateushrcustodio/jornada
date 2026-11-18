import { z } from "zod";
export const settingsSchema = z.object({
  stalledHours: z.number().min(1).max(8760),
  monitoredPipelines: z.array(z.number().int().nonnegative()).max(100),
  ignoredStages: z.array(z.string().max(100)).max(500),
  defaultPeriod: z.enum(["today", "24h", "7d", "30d"]),
  indicators: z.object({
    movements: z.boolean(),
    active: z.boolean(),
    stalled: z.boolean(),
    average: z.boolean(),
  }),
});
export const DEFAULT_SETTINGS = {
  stalledHours: 72,
  monitoredPipelines: [],
  ignoredStages: [],
  defaultPeriod: "7d",
  indicators: { movements: true, active: true, stalled: true, average: true },
} satisfies import("./types").Settings;
export const SETTINGS_KEY = "jornada-crm.settings.v1";
export const filtersSchema = z
  .object({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    pipeline: z.number().int().nonnegative().optional(),
    stage: z.string().max(100).optional(),
    stageStatus: z.enum(["open", "closed", "all"]).optional(),
    assignedById: z.number().int().positive().optional(),
    opportunityMin: z.number().min(0).max(1e13).optional(),
    opportunityMax: z.number().min(0).max(1e13).optional(),
  })
  .refine(
    (f) =>
      Date.parse(f.from) <= Date.parse(f.to) &&
      Date.parse(f.to) - Date.parse(f.from) <= 366 * 86400000,
  )
  .refine(
    (f) =>
      f.opportunityMin === undefined ||
      f.opportunityMax === undefined ||
      f.opportunityMin <= f.opportunityMax,
  );
export const sortSchema = z.object({
  by: z.enum(["opportunity", "when"]),
  dir: z.enum(["asc", "desc"]),
});
export const stalledSortSchema = z.object({
  by: z.enum(["opportunity", "duration"]),
  dir: z.enum(["asc", "desc"]),
});
