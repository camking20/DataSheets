import { z } from "zod";

export const DispositionSchema = z.enum(["green", "yellow", "red"]);
export type Disposition = z.infer<typeof DispositionSchema>;

export const MembershipRoleSchema = z.enum(["operator", "engineer", "admin"]);
export type MembershipRole = z.infer<typeof MembershipRoleSchema>;

export const RevisionStatusSchema = z.enum(["draft", "released", "superseded"]);
export type RevisionStatus = z.infer<typeof RevisionStatusSchema>;

export const SheetStatusSchema = z.enum(["in_progress", "completed", "abandoned"]);
export type SheetStatus = z.infer<typeof SheetStatusSchema>;

export const FrequencyTypeSchema = z.enum(["every_n_parts", "sample_size_per_lot"]);
export type FrequencyType = z.infer<typeof FrequencyTypeSchema>;

/**
 * Accept either a 0–1 fraction or a 1–100 percentage (common UI mistake).
 * Values above 1 and ≤ 100 are treated as percent and divided by 100.
 */
export function normalizeWarningFraction(value: unknown): unknown {
  if (typeof value !== "number" || Number.isNaN(value)) return value;
  if (value > 1 && value <= 100) return value / 100;
  return value;
}

export const WarningFractionSchema = z.preprocess(
  normalizeWarningFraction,
  z
    .number({
      required_error: "Warning band is required",
      invalid_type_error: "Warning band must be a number",
    })
    .min(0, { message: "Warning band can't be negative" })
    .max(1, {
      message:
        "Warning band must be between 0% and 100% of the way from nominal to the limit",
    })
    .default(0.75),
);

export const DimensionConfigSchema = z.object({
  nominal: z.number(),
  usl: z.number().nullable(),
  lsl: z.number().nullable(),
  warningFraction: WarningFractionSchema,
});
export type DimensionConfig = z.infer<typeof DimensionConfigSchema>;

export const InspectionFrequencySchema = z.object({
  type: FrequencyTypeSchema,
  n: z.number().int().positive(),
});
export type InspectionFrequency = z.infer<typeof InspectionFrequencySchema>;

export const CreatePartSchema = z.object({
  partNumber: z
    .string({ required_error: "Part number is required" })
    .min(1, { message: "Part number is required" })
    .max(100, { message: "Part number must be 100 characters or fewer" }),
  description: z
    .string()
    .max(500, { message: "Description must be 500 characters or fewer" })
    .optional(),
  customer: z
    .string()
    .max(200, { message: "Customer must be 200 characters or fewer" })
    .optional(),
});

export const CreateDimensionSchema = z.object({
  partRevisionId: z.string().uuid({ message: "Invalid revision" }),
  name: z
    .string({ required_error: "Dimension name is required" })
    .min(1, { message: "Dimension name is required" })
    .max(200, { message: "Dimension name must be 200 characters or fewer" }),
  balloonNumber: z
    .string()
    .max(50, { message: "Balloon number must be 50 characters or fewer" })
    .optional(),
  unit: z
    .string()
    .min(1, { message: "Unit is required" })
    .max(20, { message: "Unit must be 20 characters or fewer" })
    .default("in"),
  nominal: z.number({
    required_error: "Nominal is required",
    invalid_type_error: "Nominal must be a number",
  }),
  usl: z
    .number({ invalid_type_error: "USL must be a number" })
    .nullable()
    .optional(),
  lsl: z
    .number({ invalid_type_error: "LSL must be a number" })
    .nullable()
    .optional(),
  warningFraction: WarningFractionSchema,
  gageMethod: z
    .string()
    .max(200, { message: "Gage method must be 200 characters or fewer" })
    .optional(),
  frequencyType: FrequencyTypeSchema.default("every_n_parts"),
  frequencyN: z
    .number({
      required_error: "Frequency value is required",
      invalid_type_error: "Frequency must be a whole number",
    })
    .int({ message: "Frequency must be a whole number" })
    .positive({ message: "Frequency must be at least 1" })
    .default(1),
  displayOrder: z.number().int().nonnegative().default(0),
});

export const UpdateDimensionSchema = CreateDimensionSchema.partial()
  .omit({
    partRevisionId: true,
  })
  .extend({
    id: z.string().uuid({ message: "Invalid dimension" }),
  });

export const CreateDataSheetSchema = z.object({
  partNumber: z
    .string({ required_error: "Part number is required" })
    .min(1, { message: "Part number is required" }),
  lotNumber: z
    .string({ required_error: "Lot number is required" })
    .min(1, { message: "Lot number is required" })
    .max(100, { message: "Lot number must be 100 characters or fewer" }),
  lotSize: z
    .number({
      required_error: "Lot size is required",
      invalid_type_error: "Lot size must be a number",
    })
    .int({ message: "Lot size must be a whole number" })
    .positive({ message: "Lot size must be at least 1" }),
});

export const RecordMeasurementSchema = z.object({
  dataSheetId: z.string().uuid({ message: "Invalid data sheet" }),
  dimensionId: z.string().uuid({ message: "Invalid dimension" }),
  sampleIndex: z
    .number()
    .int({ message: "Sample index must be a whole number" })
    .nonnegative({ message: "Sample index can't be negative" }),
  value: z.number({
    required_error: "Measurement value is required",
    invalid_type_error: "Measurement value must be a number",
  }),
});

export const CompanySettingsSchema = z.object({
  defaultWarningFraction: WarningFractionSchema,
  defaultUnit: z.string().default("in"),
});
export type CompanySettings = z.infer<typeof CompanySettingsSchema>;
