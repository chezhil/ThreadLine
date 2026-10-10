import { z } from "zod";

// Field rules shared by the master-data schemas (buyers, suppliers, yarn,
// orders). Forms send strings, so numbers are coerced; every text is trimmed
// and bounded, so blank or runaway input never reaches the database.

export const requiredText = (label: string, max = 80) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} is too long (at most ${max} characters)`);

export const optionalText = (label: string, max = 200) =>
  z
    .string()
    .trim()
    .max(max, `${label} is too long (at most ${max} characters)`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Optional 15-character GSTIN (e.g. 27AASFS1234A1Z5); blank means none. */
export const optionalGstin = z
  .string()
  .trim()
  .toUpperCase()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || GSTIN_PATTERN.test(v), { message: "GSTIN must be 15 characters, like 27AASFS1234A1Z5" });

/** A positive number with a sanity ceiling, e.g. kg or rupees. */
export const positiveNumber = (label: string, max: number) =>
  z.coerce
    .number({ error: `${label} must be a number` })
    .finite(`${label} must be a number`)
    .positive(`${label} must be greater than zero`)
    .max(max, `${label} looks too large (at most ${max.toLocaleString("en-IN")})`);

/** PATCH bodies: at least one field, so an empty update is a 400, not a no-op. */
export const atLeastOneField = <T extends Record<string, unknown>>(value: T) => Object.keys(value).length > 0;
export const AT_LEAST_ONE_FIELD = { message: "Provide at least one field to update" };

/** `archived: true` archives a record, `false` restores it. */
export const archivedFlag = z.boolean({ error: "archived must be true or false" }).optional();

/** archivedAt for an update that may carry the archived flag. */
export function archivedAtFor(archived: boolean | undefined, current: Date | null): Date | null {
  if (archived === undefined) return current;
  return archived ? (current ?? new Date()) : null;
}
