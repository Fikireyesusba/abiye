import { ActionForm } from "@/components/admin/action-form";
import { Panel } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import type { AdminContext } from "@/lib/auth/permissions";
import { signOutUser } from "@/lib/admin/session-actions";
import { formatDateTime } from "@/lib/datetime";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const PLATFORM: Record<string, string> = { android: "Android", ios: "iPhone / iPad", windows: "Windows", mac: "Mac", linux: "Linux", other: "Other" };

/** Sign-in status, open sessions (with Sign out) and app installs of one person. */
export async function SignInPanel({ ctx, userId, memberId, lastSignIn }: { ctx: AdminContext; userId: string; memberId: string | null; lastSignIn: string | null }) {
  const supabase = await createSupabaseServerClient();
  const canSessions = ctx.permissions.has("security.manage");
  const [{ data: sessions }, { data: installs }] = await Promise.all([
    canSessions && memberId ? supabase.rpc("admin_signed_in_users", { p_search: memberId }) : Promise.resolve({ data: null }),
    ctx.permissions.has("customers.view") ? supabase.rpc("admin_app_installs") : Promise.resolve({ data: null }),
  ]);
  const mine = (sessions ?? []).filter((s) => s.user_id === userId);
  const devices = (installs ?? []).filter((i) => i.user_id === userId);
  return (
    <Panel title="Sign-in & devices">
      <dl className="space-y-1 text-sm" data-testid="sign-in-panel">
        <div>Last sign-in: {lastSignIn ? formatDateTime(lastSignIn, "en") : "never"}</div>
        {canSessions && (
          <div className="flex flex-wrap items-center gap-2">
            Now: {mine.length ? <Badge variant="success">Signed in ({mine.length})</Badge> : <span className="text-muted-foreground">not signed in</span>}
            {mine.length > 0 && userId !== ctx.userId && (
              <ActionForm action={signOutUser} hidden={{ userId }} submitLabel="Sign out" variant="destructive" size="sm"
                confirm="Sign this person out on every device? They must sign in again." className="space-y-0" />
            )}
          </div>
        )}
        {mine.length > 0 && <div className="text-xs text-muted-foreground">Last active {formatDateTime(mine[0].last_active_at, "en")}</div>}
        {installs && (
          <div>App installed on: {devices.length ? devices.map((d) => `${PLATFORM[d.platform] ?? d.platform} (since ${formatDateTime(d.first_seen, "en")})`).join(", ") : "no device"}</div>
        )}
      </dl>
    </Panel>
  );
}
