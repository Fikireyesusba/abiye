import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LogOut, Store } from "lucide-react";
import { BusinessNav } from "@/components/business/business-nav";
import { AppOpenPing } from "@/components/pwa/app-open-ping";
import { IdleSignOut } from "@/components/security/idle-sign-out";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { signOut } from "@/lib/auth/actions";
import { requireAdmin } from "@/lib/auth/guards";
import { deliveryMonitorSoon } from "@/lib/telegram/dispatch";
import { staffAppMetadata } from "@/lib/security/app-meta";
import { IDLE_MINUTES } from "@/lib/security/idle";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const BASE_METADATA: Metadata = {
  title: { default: "Orders", template: "%s · Abiye Business" },
  robots: { index: false, follow: false },
};
export async function generateMetadata(): Promise<Metadata> {
  return staffAppMetadata(BASE_METADATA);
}

/** Abiye Business app shell (partner shops, phone-first). Every page and action checks partner.own again. */
export default async function BusinessLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAdmin();
  await deliveryMonitorSoon();
  if (!ctx.permissions.has("partner.own")) redirect("/admin");
  const { data, error } = await (await createSupabaseServerClient()).rpc("partner_me");
  const me = (data ?? {}) as { shop?: string; city?: string; incoming?: number; at_shop?: number };
  return (
    <div className="min-h-screen bg-muted/30 pb-20">
      <AppOpenPing account={ctx.userId} />
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
        <Store className="size-5 text-primary" aria-hidden />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate font-semibold" data-testid="business-shop">{me.shop ?? "Abiye Business"}</span>
          <span className="block truncate text-xs text-muted-foreground">{ctx.fullName}{me.city ? ` · ${me.city}` : ""}</span>
        </span>
        <form action={signOut}>
          <Button type="submit" variant="ghost" size="icon" aria-label="Sign out"><LogOut className="size-4" /></Button>
        </form>
      </header>
      <main className="mx-auto w-full max-w-xl p-4">
        {error ? (
          <p className="rounded-xl border bg-card p-6 text-center text-muted-foreground" data-testid="no-shop">
            Your account is not linked to an open partner shop. Please contact the Abiye office.
          </p>
        ) : children}
      </main>
      <BusinessNav waiting={Number(me.incoming ?? 0) + Number(me.at_shop ?? 0)} />
      <Toaster />
      <IdleSignOut minutes={IDLE_MINUTES.courier} kind="admin" warning={{ text: "You will be signed out in 1 minute because of inactivity.", stay: "Stay signed in" }} />
    </div>
  );
}
