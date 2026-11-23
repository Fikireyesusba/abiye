import type { Metadata } from "next";
import { Download } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { DatabaseUpdateNeeded, PageHeader, Panel, StatCard, SubTabs, Table, Td, fieldClass, isMissingDbFunction, pickTab } from "@/components/admin/ui";
import { UserIdLink } from "@/components/admin/user-id";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KPI_METRICS, KPI_PERIODS, achievement, scaledTarget, type KpiMetric } from "@/lib/admin/kpi";
import { deleteKpiTarget, saveKpiTarget } from "@/lib/admin/kpi-actions";
import { requirePermission } from "@/lib/auth/guards";
import { first } from "@/lib/catalog/search";
import { zoneDayStartIso, zoneToday } from "@/lib/datetime";
import { formatETB, toSantim } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Staff performance" };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
const TABS = [{ key: "kpis", label: "KPIs" }, { key: "targets", label: "Targets" }] as const;

export default async function PerformancePage({ searchParams }: PageProps<"/admin/performance">) {
  const ctx = await requirePermission("kpi.view");
  const canManage = ctx.permissions.has("kpi.manage");
  const sp = await searchParams;
  const tab = pickTab(TABS, sp.tab);
  const today = zoneToday();
  const from = DAY.test(first(sp.from) ?? "") ? first(sp.from)! : `${today.slice(0, 7)}-01`;
  const to = DAY.test(first(sp.to) ?? "") && first(sp.to)! >= from ? first(sp.to)! : today;
  const rangeDays = Math.round((Date.parse(nextDay(to)) - Date.parse(from)) / 86400000);
  const supabase = await createSupabaseServerClient();
  const [{ data: rows, error }, { data: targets }] = await Promise.all([
    supabase.rpc("admin_staff_kpis", { p_from: zoneDayStartIso(from), p_to: zoneDayStartIso(nextDay(to)) }),
    supabase.from("kpi_targets").select("id, metric, period, profile_id, target, updated_at").order("metric"),
  ]);
  if (isMissingDbFunction(error)) return <DatabaseUpdateNeeded title="Staff performance" migration="20261123000056_paid_only_staff_kpis.sql" />;
  if (error) throw new Error("Could not load staff performance");
  const staff = rows ?? [];
  const targetFor = (metric: KpiMetric, userId: string) => {
    const t = (targets ?? []).find((x) => x.metric === metric && x.profile_id === userId) ?? (targets ?? []).find((x) => x.metric === metric && !x.profile_id);
    return t ? scaledTarget(metric, Number(t.target), t.period, rangeDays) : null;
  };
  const value = (r: (typeof staff)[number], metric: KpiMetric): number | null => {
    const v = r[metric as keyof typeof r];
    return v === null || v === undefined ? null : Number(v);
  };
  const sum = (metric: KpiMetric) => staff.reduce((n, r) => n + (value(r, metric) ?? 0), 0);

  return (
    <>
      <PageHeader title="Staff performance" description="KPIs per staff member for the chosen dates (Warsaw time), compared with the targets you set. Counts come from what each person did in the system." />
      <SubTabs base="/admin/performance" tabs={TABS} active={tab} keep={{ from, to }} />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="tab" value={tab} />
        <label className="text-sm">From<input type="date" name="from" defaultValue={from} max={today} className={`${fieldClass} mt-1 block`} /></label>
        <label className="text-sm">To<input type="date" name="to" defaultValue={to} max={today} className={`${fieldClass} mt-1 block`} /></label>
        <Button type="submit" variant="outline">Show</Button>
        {ctx.role === "super_admin" && (<Button asChild variant="outline" className="ml-auto">
          <a href={`/admin/exports/download?${new URLSearchParams({ kind: "kpi", from, to })}`} data-testid="kpi-export"><Download /> Excel</a>
        </Button>)}
      </form>

      {tab === "kpis" && (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Tickets resolved (team)" value={sum("tickets_resolved")} />
            <StatCard label="Orders completed (team)" value={sum("orders_completed")} />
            <StatCard label="Payments approved (team)" value={sum("payments_approved")} />
            <StatCard label="Top-ups approved (team)" value={sum("topups_approved")} />
          </div>
          <p className="mb-2 text-xs text-muted-foreground">{rangeDays} day(s). Under each value: the target for these dates and the % reached (green = met). Times: lower is better.</p>
          <Table scroll head={["User ID", ...KPI_METRICS.map((m) => m.label), "Other"]} empty="No staff members.">
            {staff.map((r) => (
              <tr key={r.user_id} className="align-top" data-row>
                <Td><UserIdLink id={r.member_id} />{!r.is_active && <span className="block text-xs text-muted-foreground">deactivated</span>}</Td>
                {KPI_METRICS.map((m) => {
                  const v = value(r, m.key);
                  const target = targetFor(m.key, r.user_id);
                  const pct = achievement(m.key, v, target);
                  return (
                    <Td key={m.key} className="whitespace-nowrap">
                      <span className="font-semibold tabular-nums" data-testid={`kpi-${m.key}`}>{v === null ? "—" : `${v}${m.unit ? ` ${m.unit}` : ""}`}</span>
                      {target !== null && (
                        <span className="block text-xs text-muted-foreground">
                          target {m.better === "lower" ? "≤ " : ""}{target}{m.unit ? ` ${m.unit}` : ""}
                          {pct !== null && <Badge variant={pct >= 100 ? "success" : pct >= 70 ? "warning" : "destructive"} className="ml-1">{pct}%</Badge>}
                        </span>
                      )}
                    </Td>
                  );
                })}
                <Td className="text-xs text-muted-foreground">
                  {Number(r.ticket_replies)} ticket replies{r.ticket_rating !== null && <> · rating {Number(r.ticket_rating)}★</>}
                  <span className="block">{Number(r.order_steps)} order steps · {Number(r.payments_rejected)} payments / {Number(r.topups_rejected)} top-ups rejected</span>
                  {Number(r.instore_sales_etb) > 0 && <span className="block">in-store {formatETB(toSantim(Number(r.instore_sales_etb)))}</span>}
                </Td>
              </tr>
            ))}
          </Table>
        </>
      )}

      {tab === "targets" && (
        <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
          {canManage ? (
            <Panel title="Set a target">
              <ActionForm action={saveKpiTarget} submitLabel="Save target" className="space-y-3">
                <label className="block text-sm">KPI
                  <select name="metric" required className={`${fieldClass} mt-1`}>{KPI_METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}{m.better === "lower" ? " (maximum)" : ""}</option>)}</select>
                </label>
                <div className="flex flex-wrap gap-3">
                  <label className="text-sm">Target<input name="target" type="number" min={0} step="0.1" required className={`${fieldClass} mt-1 block w-32`} /></label>
                  <label className="text-sm">Per
                    <select name="period" defaultValue="month" className={`${fieldClass} mt-1 block w-auto`}>{KPI_PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
                  </label>
                </div>
                <label className="block text-sm">For
                  <select name="profileId" defaultValue="" className={`${fieldClass} mt-1`}>
                    <option value="">Every staff member</option>
                    {staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.member_id}</option>)}
                  </select>
                </label>
                <p className="text-xs text-muted-foreground">Counts are scaled to the dates you view (e.g. 20 per week shows as 40 for two weeks). Times (resolution, first reply, payment review) are a maximum. A target for one person replaces the “every staff member” target for them. Saving the same KPI for the same person changes it.</p>
              </ActionForm>
            </Panel>
          ) : <p className="text-sm text-muted-foreground">Only the Super Admin sets targets.</p>}
          <Panel title="Current targets">
            {(targets ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No targets yet.</p> : (
              <ul className="divide-y text-sm" data-testid="kpi-targets">
                {(targets ?? []).map((t) => {
                  const m = KPI_METRICS.find((x) => x.key === t.metric);
                  const who = t.profile_id ? staff.find((s) => s.user_id === t.profile_id) : null;
                  return (
                    <li key={t.id} className={cn("flex flex-wrap items-center gap-2 py-2")}>
                      <span className="font-medium">{m?.label ?? t.metric}</span>
                      <span>{m?.better === "lower" ? "≤ " : ""}{Number(t.target)}{m?.unit ? ` ${m.unit}` : ""} {m?.better === "lower" ? "" : KPI_PERIODS.find((p) => p.key === t.period)?.label}</span>
                      <span className="text-muted-foreground">· {who ? <UserIdLink id={who.member_id} /> : "every staff member"}</span>
                      {canManage && (
                        <ActionForm action={deleteKpiTarget} hidden={{ id: t.id }} submitLabel="Remove" variant="outline" size="sm" className="ml-auto space-y-0" />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
          <Panel title="How each KPI is measured" className="lg:col-span-2">
            <dl className="grid gap-2 text-sm sm:grid-cols-2">{KPI_METRICS.map((m) => <div key={m.key}><dt className="font-medium">{m.label}</dt><dd className="text-muted-foreground">{m.help}</dd></div>)}</dl>
          </Panel>
        </div>
      )}
    </>
  );
}
