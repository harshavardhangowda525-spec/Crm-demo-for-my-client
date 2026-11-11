import { z } from "zod";
import { normalizePhone } from "./phone";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid date");
const optionalIsoDate = z
  .union([isoDate, z.literal("")])
  .optional()
  .transform((v) => (v ? v : null));
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : null));
const uuid = z.uuid("Invalid reference");
const optionalUuid = z
  .union([uuid, z.literal("")])
  .optional()
  .transform((v) => (v ? v : null));

export const phoneSchema = z
  .string()
  .min(1, "Enter a mobile number")
  .transform((v, ctx) => {
    const e164 = normalizePhone(v);
    if (!e164) {
      ctx.addIssue({ code: "custom", message: "Enter a valid mobile number (e.g. 98765 43210)" });
      return z.NEVER;
    }
    return e164;
  });

export const enquiryStatusInput = z.enum(["new", "follow_up_pending", "interested", "not_interested"]);
export const sourceInput = z.enum(["walk_in", "phone", "instagram", "facebook", "website", "referral", "google", "other"]);
export const paymentMethodInput = z.enum(["upi", "cash", "card", "bank_transfer", "other"]);

export const customerCreateSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the customer's name").max(120),
  phone: phoneSchema,
  email: z
    .union([z.email("Enter a valid email"), z.literal("")])
    .optional()
    .transform((v) => (v ? v : null)),
  dateOfBirth: optionalIsoDate,
  gender: z
    .union([z.enum(["male", "female", "other", "prefer_not_to_say"]), z.literal("")])
    .optional()
    .transform((v) => (v ? v : null)),
  interestedPlanId: optionalUuid,
  source: sourceInput.default("walk_in"),
  enquiryDate: optionalIsoDate,
  status: enquiryStatusInput.default("new"),
  followUpDate: optionalIsoDate,
  assignedStaffId: optionalUuid,
  notes: optionalText(4000),
  whatsappOptIn: z.boolean().default(false),
});
export type CustomerCreateInput = z.input<typeof customerCreateSchema>;

export const customerUpdateSchema = customerCreateSchema
  .pick({ fullName: true, phone: true, email: true, dateOfBirth: true, gender: true, assignedStaffId: true, notes: true })
  .extend({ customerId: uuid, whatsappOptIn: z.boolean() });

export const enquiryUpdateSchema = z.object({
  enquiryId: uuid,
  status: enquiryStatusInput,
  followUpDate: optionalIsoDate,
  interestedPlanId: optionalUuid,
  assignedStaffId: optionalUuid,
});

export const newEnquirySchema = z.object({
  customerId: uuid,
  interestedPlanId: optionalUuid,
  source: sourceInput,
  followUpDate: optionalIsoDate,
  notes: optionalText(4000),
});

export const noteSchema = z.object({
  customerId: uuid,
  enquiryId: optionalUuid,
  body: z.string().trim().min(1, "Write a note").max(4000),
});

export const followUpSchema = z.object({
  enquiryId: uuid,
  kind: z.enum(["follow_up_call", "follow_up_whatsapp", "visit"]),
  outcome: z.enum(["reached", "no_answer", "call_back", "interested", "not_interested"]),
  body: z.string().trim().min(1, "Add a short summary").max(4000),
  nextFollowUpDate: optionalIsoDate,
  newStatus: z
    .union([enquiryStatusInput, z.literal("")])
    .optional()
    .transform((v) => (v ? v : null)),
});

const paise = z.number().int().min(0).max(100_000_000_00);

export const activationSchema = z.object({
  customerId: uuid,
  planId: uuid,
  startDate: isoDate,
  discountPaise: paise.default(0),
  amountPaidPaise: paise,
  paymentMethod: paymentMethodInput,
  paymentReference: optionalText(120),
  idempotencyKey: uuid,
});

export const pauseSchema = z
  .object({
    membershipId: uuid,
    startDate: isoDate,
    endDate: isoDate,
    reason: optionalText(500),
    idempotencyKey: uuid,
  })
  .refine((v) => v.endDate >= v.startDate, { message: "End date must be on or after the start date", path: ["endDate"] });

export const paymentSchema = z.object({
  invoiceId: uuid,
  amountPaise: z.number().int().positive("Enter an amount"),
  method: paymentMethodInput,
  reference: optionalText(120),
  idempotencyKey: uuid,
});

export const planSchema = z.object({
  planId: optionalUuid,
  name: z.string().trim().min(2, "Name the plan").max(80),
  durationValue: z.number().int().min(1).max(1000),
  durationUnit: z.enum(["day", "month"]),
  basePricePaise: paise,
  gstRate: z
    .union([z.number().min(0).max(40), z.null()])
    .optional()
    .transform((v) => (v === undefined ? null : v)),
  description: optionalText(500),
  pauseAllowanceDays: z.number().int().min(0).max(60),
  active: z.boolean(),
});

export const gymSettingsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  legalName: optionalText(160),
  addressLine1: optionalText(160),
  addressLine2: optionalText(160),
  city: optionalText(80),
  state: optionalText(80),
  stateCode: z
    .union([z.string().regex(/^\d{2}$/, "Two-digit GST state code"), z.literal("")])
    .optional()
    .transform((v) => (v ? v : null)),
  postalCode: optionalText(12),
  phone: z
    .union([phoneSchema, z.literal("")])
    .optional()
    .transform((v) => (v ? v : null)),
  email: z
    .union([z.email(), z.literal("")])
    .optional()
    .transform((v) => (v ? v : null)),
  gstin: z
    .union([z.string().toUpperCase().regex(/^\d{2}[A-Z0-9]{13}$/, "GSTIN must be 15 characters"), z.literal("")])
    .optional()
    .transform((v) => (v ? v : null)),
  gstEnabled: z.boolean(),
  defaultGstRate: z.number().min(0).max(40),
  sacCode: z.string().trim().min(4).max(8),
  invoicePrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,10}$/, "Letters, digits or dashes (max 10)"),
  pauseMaxDays: z.number().int().min(0).max(60),
  reminderOffsets: z.array(z.number().int().min(0).max(60)).min(1).max(6),
  activationRule: z.enum(["full_payment", "any_payment", "immediate"]),
  renewalFollowUpDays: z.number().int().min(1).max(60),
  whatsappProvider: z.enum(["mock", "meta_cloud"]),
});

export const staffInviteSchema = z.object({
  email: z.email("Enter a valid email"),
  role: z.enum(["owner", "admin", "staff"]),
  fullName: optionalText(120),
});

export const reasonSchema = z.string().trim().min(3, "Give a short reason").max(500);
