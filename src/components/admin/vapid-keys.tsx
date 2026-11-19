"use client";
import { useState } from "react";
import { Copy, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const b64url = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * Creates the phone-notification (VAPID) key pair IN THIS BROWSER with the
 * Web Crypto API. Nothing is sent anywhere: the owner copies the values into
 * Vercel's environment variables.
 */
export function VapidKeyGenerator({ suggestedSubject }: { suggestedSubject: string }) {
  const [keys, setKeys] = useState<{ publicKey: string; privateKey: string } | null>(null);
  const generate = async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const raw = await crypto.subtle.exportKey("raw", pair.publicKey);
    const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    setKeys({ publicKey: b64url(raw), privateKey: jwk.d! });
  };
  const rows = keys
    ? [["VAPID_PUBLIC_KEY", keys.publicKey], ["VAPID_PRIVATE_KEY", keys.privateKey], ["VAPID_SUBJECT", suggestedSubject]]
    : [];
  return (
    <div className="space-y-3 text-sm">
      {!keys ? (
        <Button type="button" variant="outline" size="sm" onClick={() => void generate()}><KeyRound /> Create notification keys</Button>
      ) : (
        <>
          <p className="rounded-md bg-warning/15 p-2">
            Copy these three values into <strong>Vercel → Settings → Environment Variables</strong> (Production), then <strong>Redeploy</strong>.
            They were created in your browser and are not saved anywhere — if you leave this page, just create new ones.
            Keep the private key secret (never paste it in chats or emails).
          </p>
          <dl className="space-y-2">
            {rows.map(([k, v]) => (
              <div key={k} className="space-y-1">
                <dt className="font-mono text-xs font-semibold">{k}</dt>
                <dd className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 rounded bg-muted px-2 py-1 text-xs break-all select-all">{v}</code>
                  <Button type="button" size="icon" variant="ghost" className="size-8 shrink-0" aria-label={`Copy ${k}`}
                    onClick={() => void navigator.clipboard.writeText(v).then(() => toast.success(`${k} copied`))}><Copy className="size-4" /></Button>
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted-foreground">VAPID_SUBJECT is a contact address for the push services; change it to your email if you prefer (format: mailto:you@yourdomain.com).</p>
        </>
      )}
    </div>
  );
}
