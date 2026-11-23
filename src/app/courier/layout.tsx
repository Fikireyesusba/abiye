import type { Metadata } from "next";
import { staffAppMetadata } from "@/lib/security/app-meta";
import { redirect } from "next/navigation";
import { LogOut, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { IdleSignOut } from "@/components/security/idle-sign-out";
import { AppOpenPing } from "@/components/pwa/app-open-ping";
import { signOut } from "@/lib/auth/actions";
import { requireAdmin } from "@/lib/auth/guards";
import { IDLE_MINUTES } from "@/lib/security/idle";

const BASE_METADATA: Metadata = {
  title: { default: "Deliveries", template: "%s · Abiye Courier" },
  robots: { index: false, follow: false },
};
export async function generateMetadata(): Promise<Metadata> {
  return staffAppMetadata(BASE_METADATA);
}

/** Courier app shell (phone-first). Every page and action checks deliveries.own again. */
export default async function CourierLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAdmin();
  if (!ctx.permissions.has("deliveries.own")) redirect("/admin");
  return (
    <div className="min-h-screen bg-muted/30">
      <AppOpenPing account={ctx.userId} />
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
        <Truck className="size-5 text-primary" aria-hidden />
        <span className="flex-1 leading-tight">
          <span className="block font-semibold">Deliveries</span>
          <span className="block text-xs text-muted-foreground">{ctx.fullName}</span>
        </span>
        <form action={signOut}>
          <Button type="submit" variant="ghost" size="icon" aria-label="Sign out"><LogOut className="size-4" /></Button>
        </form>
      </header>
      <main className="mx-auto w-full max-w-xl p-4">{children}</main>
      <Toaster />
      <IdleSignOut minutes={IDLE_MINUTES.courier} kind="admin" warning={{ text: "You will be signed out in 1 minute because of inactivity.", stay: "Stay signed in" }} />
    </div>
  );
}
