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
  // Second bot / group for security alerts, sign-ins and admin actions (optional).
  TELEGRAM_SECURITY_BOT_TOKEN: z
    .string()
    .regex(/^\d+:[A-Za-z0-9_-]{30,}$/, "Invalid Telegram bot token format")
    .optional(),
  TELEGRAM_SECURITY_CHAT_ID: z.string().regex(/^-?\d+$/, "Chat id must be numeric").optional(),
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
  // Customer phone notifications (Web Push / VAPID). Optional: without them, none are sent.
  VAPID_PUBLIC_KEY: z.string().regex(/^[A-Za-z0-9_-]{80,90}$/, "Invalid VAPID public key").optional(),
  VAPID_PRIVATE_KEY: z.string().regex(/^[A-Za-z0-9_-]{40,45}$/, "Invalid VAPID private key").optional(),
  VAPID_SUBJECT: z.string().regex(/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/, "VAPID_SUBJECT must be mailto:you@domain or an https URL").optional(),
  // Only for tests: send push messages to a local mock instead of the push service.
  PUSH_TEST_ENDPOINT_BASE: z
    .url()
    .refine((u) => /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(u), "Local addresses only")
    .optional(),
  // Only for tests (a local mock of the Resend API).
  EMAIL_API_BASE: z
    .url()
    .refine((u) => u.startsWith("https://") || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(u), "Must be https (or http on localhost)")
    .optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

const OPTIONAL = new Set([
  "TELEGRAM_BOT_TOKEN", "TELEGRAM_ADMIN_CHAT_ID", "TELEGRAM_SECURITY_BOT_TOKEN", "TELEGRAM_SECURITY_CHAT_ID", "RESEND_API_KEY", "EMAIL_FROM", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT",
]);
const optionalProblems: Record<string, string> = {};

/** Optional settings that were present but invalid (name → reason; never the value). */
export function optionalEnvProblems(): Readonly<Record<string, string>> {
  getServerEnv();
  return optionalProblems;
}

export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const values: Record<string, string | undefined> = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    // Supabase's new key names, with fallback to the legacy anon/service_role names.
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY,
    APP_URL: process.env.APP_URL,
    CRON_SECRET: process.env.CRON_SECRET,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || undefined,
    TELEGRAM_ADMIN_CHAT_ID: process.env.TELEGRAM_ADMIN_CHAT_ID || undefined,
    TELEGRAM_SECURITY_BOT_TOKEN: process.env.TELEGRAM_SECURITY_BOT_TOKEN || undefined,
    TELEGRAM_SECURITY_CHAT_ID: process.env.TELEGRAM_SECURITY_CHAT_ID || undefined,
    TELEGRAM_API_BASE: process.env.TELEGRAM_API_BASE || undefined,
    RESEND_API_KEY: process.env.RESEND_API_KEY || undefined,
    EMAIL_FROM: process.env.EMAIL_FROM || undefined,
    EMAIL_API_BASE: process.env.EMAIL_API_BASE || undefined,
    VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY || undefined,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY || undefined,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT || undefined,
    PUSH_TEST_ENDPOINT_BASE: process.env.PUSH_TEST_ENDPOINT_BASE || undefined,
  };
  // Optional integrations: tolerate pasting slips (spaces, quotes), and never let a bad
  // value take the whole site down — that feature is switched off and reported instead.
  for (const k of OPTIONAL) {
    const v = values[k]?.trim().replace(/^(["'])(.*)\1$/, "$2").trim();
    values[k] = v || undefined;
  }
  let parsed = serverEnvSchema.safeParse(values);
  const bad = parsed.success ? [] : parsed.error.issues.map((i) => String(i.path[0]));
  if (!parsed.success && bad.every((k) => OPTIONAL.has(k))) {
    for (const issue of parsed.error.issues) {
      const k = String(issue.path[0]);
      optionalProblems[k] = issue.message;
      values[k] = undefined;
    }
    console.error(`[env] ignoring invalid optional settings: ${Object.keys(optionalProblems).join(", ")}`);
    parsed = serverEnvSchema.safeParse(values);
  }
  if (!parsed.success) {
    // Report variable NAMES only — never values.
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid server environment configuration — ${problems}`);
  }
  cached = parsed.data;
  return cached;
}
