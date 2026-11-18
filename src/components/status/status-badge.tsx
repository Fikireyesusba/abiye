import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";

type Variant = "default" | "secondary" | "accent" | "destructive" | "success" | "warning" | "info" | "outline";

const ORDER: Record<string, Variant> = {
  awaiting_payment: "warning",
  pending_verification: "info",
  payment_rejected: "destructive",
  confirmed: "success",
  processing: "info",
  ready_for_pickup: "accent",
  out_for_delivery: "accent",
  completed: "success",
  cancelled: "secondary",
  expired: "secondary",
};
const PAYMENT: Record<string, Variant> = {
  unpaid: "warning",
  pending_verification: "info",
  verified: "success",
  rejected: "destructive",
  refunded: "secondary",
};
const PRINT: Record<string, Variant> = {
  submitted: "secondary",
  awaiting_quote: "warning",
  awaiting_payment: "warning",
  payment_verification: "info",
  printing: "info",
  ready: "accent",
  completed: "success",
  cancelled: "secondary",
};

/** Translated, color-coded status pill for orders, payments and printing jobs. */
export function StatusBadge({ kind, status }: { kind: "order" | "payment" | "print"; status: string }) {
  const ns = kind === "order" ? "orderStatus" : kind === "payment" ? "paymentStatus" : "printStatus";
  const t = useTranslations(ns);
  const map = kind === "order" ? ORDER : kind === "payment" ? PAYMENT : PRINT;
  return <Badge variant={map[status] ?? "outline"}>{t.has(status) ? t(status) : status}</Badge>;
}
