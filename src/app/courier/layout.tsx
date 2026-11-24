import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LogOut, Truck } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { CourierNav } from "@/components/courier/courier-nav";
import { AppOpenPing } from "@/components/pwa/app-open-ping";
import { IdleSignOut } from "@/components/security/idle-sign-out";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { signOut } from "@/lib/auth/actions";
import { requireAdmin } from "@/lib/auth/guards";
import { setDuty } from "@/lib/courier/actions";
import { staffAppMetadata } from "@/lib/security/app-meta";
import { IDLE_MINUTES } from "@/lib/security/idle";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const BASE_METADATA: Metadata = {
  title: { default: "Deliveries", template: "%s · Abiye Courier" },
  robots: { index: false, follow: false },
};
export async function generateMetadata(): Promise<Metadata> {
  return staffAppMetadata(BASE_METADATA);
}

/** Courier app shell (phone-first): header with on-duty switch, bottom tabs. Every page and action checks deliveries.own again. */
export default async function CourierLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAdmin();
  if (!ctx.permissions.has("deliveries.own")) redirect("/admin");
  const { data } = await (await createSupabaseServerClient()).rpc("courier_me");
  const me = (data ?? {}) as { on_duty?: boolean; unread?: number };
  const onDuty = !!me.on_duty;
  return (
    <div className="min-h-screen bg-muted/30 pb-20">
      <AppOpenPing account={ctx.userId} />
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
        <Truck className="size-5 text-primary" aria-hidden />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate font-semibold">{ctx.fullName}</span>
          <span className={`block text-xs ${onDuty ? "text-success" : "text-muted-foreground"}`} data-testid="duty-status">{onDuty ? "● On duty" : "○ Off duty"}</span>
        </span>
        <ActionForm action={setDuty} hidden={{ on: String(!onDuty) }} submitLabel={onDuty ? "Go off duty" : "Go on duty"} size="sm"
          variant={onDuty ? "outline" : "default"} className="space-y-0" />
        <form action={signOut}>
          <Button type="submit" variant="ghost" size="icon" aria-label="Sign out"><LogOut className="size-4" /></Button>
        </form>
      </header>
      <main className="mx-auto w-full max-w-xl p-4">{children}</main>
      <CourierNav unread={Number(me.unread ?? 0)} />
      <Toaster />
      <IdleSignOut minutes={IDLE_MINUTES.courier} kind="admin" warning={{ text: "You will be signed out in 1 minute because of inactivity.", stay: "Stay signed in" }} />
    </div>
  );
}
