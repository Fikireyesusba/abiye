import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { DatabaseUpdateNeeded, PageHeader, StatCard, SubTabs, Table, Td, fieldClass, isMissingDbFunction, pickTab } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { UserIdLink } from "@/components/admin/user-id";
import { Button } from "@/components/ui/button";
import { signOutUser } from "@/lib/admin/session-actions";
import { requirePermission } from "@/lib/auth/guards";
import { first } from "@/lib/catalog/search";
import { formatDateTime, zoneDayStartIso, zoneToday } from "@/lib/datetime";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Signed-in users" };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
const day = (v: unknown) => (typeof v === "string" && DAY.test(v) ? v : "");

/** Short device description from the browser's user agent. */
function device(ua: string | null): string {
  if (!ua) return "—";
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad|iOS/i.test(ua) ? "iPhone / iPad" : /Windows/i.test(ua) ? "Windows" : /Mac OS/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : "Other";
  const br = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${br} · ${os}`;
}

const PLATFORM: Record<string, string> = { android: "Android", ios: "iPhone / iPad", windows: "Windows", mac: "Mac", linux: "Linux", other: "Other" };

export default async function UsersPage({ searchParams }: PageProps<"/admin/users">) {
  const ctx = await requirePermission("security.manage", "customers.view");
  const canSessions = ctx.permissions.has("security.manage");
  const tabsAll = [
    ...(canSessions ? [{ key: "now", label: "Signed in now" }, { key: "last", label: "Last sign-in" }] : []),
    ...(ctx.permissions.has("customers.view") ? [{ key: "installs", label: "App installs" }] : []),
  ];
  const sp = await searchParams;
  const tab = pickTab(tabsAll, sp.tab);
  const q = (first(sp.q) ?? "").trim().slice(0, 60);
  const supabase = await createSupabaseServerClient();
  const probe = await supabase.rpc("admin_app_installs");
  if (isMissingDbFunction(probe.error)) return <DatabaseUpdateNeeded title="Signed-in users" migration="20261122000052_user_id_sessions_support.sql" />;

  return (
    <>
      <PageHeader title="Signed-in users" description="Who is signed in right now, when everyone last signed in, and who installed the app. Each person is shown with their User ID." />
      <SubTabs base="/admin/users" tabs={tabsAll} active={tab} />
      {tab === "now" && <SignedInNow />}
      {tab === "last" && <LastSignIn />}
      {tab === "installs" && <Installs />}
    </>
  );

  function Search({ extra }: { extra?: React.ReactNode }) {
    return (
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="tab" value={tab} />
        <label className="text-sm">Search<input name="q" defaultValue={q} placeholder="User ID, name or email" maxLength={60} className={`${fieldClass} mt-1 block w-56`} /></label>
        {extra}
        <Button type="submit" variant="outline">Show</Button>
        {(q || sp.from || sp.to || sp.before) && <Button asChild variant="ghost"><Link href={`/admin/users?tab=${tab}`}>Clear</Link></Button>}
        {canSessions && (
          <Button asChild variant="outline" className="ml-auto">
            <a href={`/admin/users/export?${new URLSearchParams(Object.entries({ tab, q, from: day(sp.from), to: day(sp.to), before: day(sp.before) }).filter(([, v]) => v))}`} data-testid="users-export">
              <Download /> Excel
            </a>
          </Button>
        )}
      </form>
    );
  }

  function Person({ r }: { r: { user_id: string | null; member_id: string | null; is_staff: boolean; role_name?: string | null } }) {
    return (
      <>
        <UserIdLink id={r.member_id} />
        {r.is_staff && <Badge variant="secondary" className="ml-2">{r.role_name ?? "Staff"}</Badge>}
      </>
    );
  }

  async function SignedInNow() {
    const { data } = await supabase.rpc("admin_signed_in_users", { p_search: q || undefined });
    const rows = data ?? [];
    const people = new Set(rows.map((r) => r.user_id));
    const recent = rows.filter((r) => Date.now() - Date.parse(r.last_active_at) < 3600_000).length;
    return (
      <>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <StatCard label="Signed in" value={people.size} hint="people with an open session" />
          <StatCard label="Active in the last hour" value={recent} />
          <StatCard label="Staff signed in" value={new Set(rows.filter((r) => r.is_staff).map((r) => r.user_id)).size} />
        </div>
        <Search />
        <Table scroll head={["User ID", "Signed in", "Last active", "Device", ""]} empty="Nobody is signed in.">
          {rows.map((r) => (
            <tr key={r.session_id} data-row>
              <Td><Person r={r} /></Td>
              <Td className="text-xs whitespace-nowrap">{formatDateTime(r.signed_in_at, "en")}</Td>
              <Td className="text-xs whitespace-nowrap">{formatDateTime(r.last_active_at, "en")}</Td>
              <Td className="text-xs">{device(r.user_agent)}{r.ip && <span className="block text-muted-foreground">{r.ip}</span>}</Td>
              <Td>
                {r.user_id !== ctx.userId && (
                  <ActionForm action={signOutUser} hidden={{ userId: r.user_id }} submitLabel="Sign out" variant="destructive" size="sm"
                    confirm={`Sign out User ID ${r.member_id}? They must sign in again on every device.`} className="space-y-0" />
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </>
    );
  }

  async function LastSignIn() {
    const from = day(sp.from), to = day(sp.to), before = day(sp.before);
    const { data } = await supabase.rpc("admin_last_sign_ins", {
      p_from: from ? zoneDayStartIso(from) : undefined, p_to: to ? zoneDayStartIso(nextDay(to)) : undefined,
      p_before: before ? zoneDayStartIso(before) : undefined, p_search: q || undefined,
    });
    const rows = data ?? [];
    const today = zoneToday();
    return (
      <>
        <Search extra={<>
          <label className="text-sm">From<input type="date" name="from" defaultValue={from} max={today} className={`${fieldClass} mt-1 block`} /></label>
          <label className="text-sm">To<input type="date" name="to" defaultValue={to} max={today} className={`${fieldClass} mt-1 block`} /></label>
          <label className="text-sm">Or: not signed in since<input type="date" name="before" defaultValue={before} max={today} className={`${fieldClass} mt-1 block`} /></label>
        </>} />
        <p className="mb-2 text-sm text-muted-foreground" data-testid="last-count">{rows.length} account(s){from || to ? ` signed in ${from || "…"} to ${to || "…"}` : ""}{before ? ` not signed in since ${before}` : ""}.</p>
        <Table scroll head={["User ID", "Last sign-in", "Account created", "Now"]} empty="No accounts match.">
          {rows.map((r) => (
            <tr key={r.user_id} data-row>
              <Td><Person r={r} /></Td>
              <Td className="text-xs whitespace-nowrap">{r.last_sign_in_at ? formatDateTime(r.last_sign_in_at, "en") : "Never"}</Td>
              <Td className="text-xs whitespace-nowrap">{formatDateTime(r.created_at, "en")}</Td>
              <Td>{r.signed_in_now ? <Badge variant="success">Signed in</Badge> : <span className="text-xs text-muted-foreground">—</span>}</Td>
            </tr>
          ))}
        </Table>
      </>
    );
  }

  function Installs() {
    const needle = q.toLowerCase();
    const rows = (probe.data ?? []).filter((r) => !needle || r.member_id === q || (r.email ?? "").toLowerCase().includes(needle) || (r.full_name ?? "").toLowerCase().includes(needle));
    const accounts = new Set(rows.filter((r) => r.user_id).map((r) => r.user_id));
    const byPlatform = rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r.platform]: (m[r.platform] ?? 0) + 1 }), {});
    return (
      <>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <StatCard label="Devices with the app" value={<span data-testid="install-count">{rows.length}</span>} />
          <StatCard label="People (signed in on it)" value={accounts.size} />
          <StatCard label="By device" value={<span className="text-base">{Object.entries(byPlatform).map(([k, n]) => `${PLATFORM[k] ?? k} ${n}`).join(" · ") || "—"}</span>} />
        </div>
        <Search />
        <p className="mb-3 text-sm text-muted-foreground">A device is counted the first time the installed app (home-screen shortcut) is opened on it. If nobody signed in on that device yet, it shows as “Not signed in”.</p>
        <Table scroll head={["User ID", "Device", "Installed (first opened)", "Last opened", "Opens"]} empty="Nobody has opened the installed app yet.">
          {rows.map((r) => (
            <tr key={r.device_id} data-row>
              <Td>{r.user_id ? <Person r={r} /> : <span className="text-muted-foreground">Not signed in</span>}</Td>
              <Td>{PLATFORM[r.platform] ?? r.platform}</Td>
              <Td className="text-xs whitespace-nowrap">{formatDateTime(r.first_seen, "en")}</Td>
              <Td className="text-xs whitespace-nowrap">{formatDateTime(r.last_seen, "en")}</Td>
              <Td className="tabular-nums">{r.opens}</Td>
            </tr>
          ))}
        </Table>
      </>
    );
  }
}
