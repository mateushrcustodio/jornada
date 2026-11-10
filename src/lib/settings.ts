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
