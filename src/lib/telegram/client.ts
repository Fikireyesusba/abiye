import "server-only";

/**
 * Minimal Telegram Bot API client. Never logs the token (it is part of the URL).
 * Errors are classified so the dispatcher can decide: retry later, slow down, or give up.
 */
export type SendResult =
  | { ok: true }
  | { ok: false; kind: "rate_limited"; retryAfter: number; error: string }
  | { ok: false; kind: "retry" | "permanent"; error: string };

export interface TelegramConfig {
  token: string;
  chatId: string;
  apiBase: string;
}

async function call(cfg: TelegramConfig, method: string, body: FormData | Record<string, unknown>): Promise<SendResult> {
  const isForm = body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`${cfg.apiBase}/bot${cfg.token}/${method}`, {
      method: "POST",
      headers: isForm ? undefined : { "content-type": "application/json" },
      body: isForm ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    return { ok: false, kind: "retry", error: `network: ${(e as Error).name}` };
  }
  let data: { ok?: boolean; description?: string; parameters?: { retry_after?: number } } = {};
  try {
    data = await res.json();
  } catch {
    // non-JSON (proxy error page etc.)
  }
  if (res.ok && data.ok) return { ok: true };
  const error = `${res.status} ${data.description ?? res.statusText}`.slice(0, 300);
  if (res.status === 429) return { ok: false, kind: "rate_limited", retryAfter: data.parameters?.retry_after ?? 30, error };
  // 5xx and gateway problems are transient; 400/401/403/404 (bad token, chat not found, bot blocked) need a human.
  return { ok: false, kind: res.status >= 500 ? "retry" : "permanent", error };
}

export function sendMessage(cfg: TelegramConfig, text: string) {
  return call(cfg, "sendMessage", { chat_id: cfg.chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true } });
}

/** One API call for text + receipt, so a retry can never post the text twice. */
export function sendMedia(cfg: TelegramConfig, kind: "photo" | "document", file: Blob, filename: string, caption: string) {
  const form = new FormData();
  form.set("chat_id", cfg.chatId);
  form.set("caption", caption);
  form.set("parse_mode", "HTML");
  form.set(kind, file, filename);
  return call(cfg, kind === "photo" ? "sendPhoto" : "sendDocument", form);
}
