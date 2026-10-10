import { z } from "zod";

// Account page schemas — shared by the /api/me routes and the account forms.

/** Largest accepted avatar data URL. The browser resizes to 256px first, so a
 * real one is ~20–40 KB; this only stops someone posting a huge blob. */
export const MAX_AVATAR_CHARS = 140_000;

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} can be at most ${max} characters`)
    .transform((v) => (v === "" ? null : v))
    .nullable();

export const profileSchema = z
  .object({
    fullName: optionalText(80, "Name"),
    email: z
      .string()
      .trim()
      .max(120, "Email can be at most 120 characters")
      .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email address")
      .transform((v) => (v === "" ? null : v.toLowerCase()))
      .nullable(),
    phone: z
      .string()
      .trim()
      .max(24, "Phone can be at most 24 characters")
      .refine((v) => v === "" || (/^[0-9+()\-\s]+$/.test(v) && v.replace(/\D/g, "").length >= 7), "Enter a valid phone number")
      .transform((v) => (v === "" ? null : v))
      .nullable(),
    jobTitle: optionalText(60, "Job title"),
    avatar: z
      .string()
      .max(MAX_AVATAR_CHARS, "That picture is too large")
      .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/, "Use a JPEG, PNG or WebP image")
      .nullable(),
  })
  .partial()
  .strict();

export type ProfileInput = z.infer<typeof profileSchema>;

export const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    // bcrypt only reads the first 72 bytes, so a longer password would be silently truncated.
    newPassword: z
      .string()
      .min(8, "Use at least 8 characters")
      .max(72, "Use at most 72 characters")
      .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), "Include at least one letter and one number"),
  })
  .strict();
