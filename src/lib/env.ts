import "server-only";
import { z } from "zod";

/**
 * Server-side environment. Parsed lazily so that pages which do not need a
 * given secret can still build; any code path that needs one fails loudly with
 * a clear message instead of running half-configured.
 *
 * NEVER import this file from a Client Component ("server-only" enforces it).
 */
const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  SUPABASE_SECRET_KEY: z.string().min(20),
  APP_URL: z.url(),
  CRON_SECRET: z.string().min(32, "CRON_SECRET must be at least 32 characters"),
  TELEGRAM_BOT_TOKEN: z
    .string()
    .regex(/^\d+:[A-Za-z0-9_-]{30,}$/, "Invalid Telegram bot token format")
    .optional(),
  TELEGRAM_ADMIN_CHAT_ID: z.string().regex(/^-?\d+$/, "Chat id must be numeric").optional(),
  // Only for tests (a local mock of the Bot API). https anywhere, http only on localhost.
  TELEGRAM_API_BASE: z
    .url()
    .refine((u) => u.startsWith("https://") || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(u), "Must be https (or http on localhost)")
    .optional(),
  // Customer emails (Resend API). Optional: without them, customer emails are not sent.
  RESEND_API_KEY: z.string().regex(/^re_[A-Za-z0-9_]{10,}$/, "Invalid Resend API key format").optional(),
  EMAIL_FROM: z
    .string()
    .regex(/^[^<>\r\n]{1,80} <[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>$|^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/, "EMAIL_FROM must look like: Abiye <orders@yourdomain.com>")
    .optional(),
  // Only for tests (a local mock of the Resend API).
  EMAIL_API_BASE: z
    .url()
    .refine((u) => u.startsWith("https://") || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(u), "Must be https (or http on localhost)")
    .optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    // Supabase's new key names, with fallback to the legacy anon/service_role names.
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY,
    APP_URL: process.env.APP_URL,
    CRON_SECRET: process.env.CRON_SECRET,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || undefined,
    TELEGRAM_ADMIN_CHAT_ID: process.env.TELEGRAM_ADMIN_CHAT_ID || undefined,
    TELEGRAM_API_BASE: process.env.TELEGRAM_API_BASE || undefined,
    RESEND_API_KEY: process.env.RESEND_API_KEY || undefined,
    EMAIL_FROM: process.env.EMAIL_FROM || undefined,
    EMAIL_API_BASE: process.env.EMAIL_API_BASE || undefined,
  });
  if (!parsed.success) {
    // Report variable NAMES only — never values.
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid server environment configuration — ${problems}`);
  }
  cached = parsed.data;
  return cached;
}
