"use client";
import { useMemo, useState, useTransition } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fieldClass } from "@/components/admin/ui";
import { recordInStoreSale } from "@/lib/admin/instore-actions";

export interface CounterProduct { id: string; name: string; sku: string; price: number; stock: number | null }
type Line = { productId: string; quantity: number };
const etb = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} ETB`;

/** Counter sale: pick products and quantities, how it was paid, optional customer and discount. */
export function InStoreSaleForm({ products }: { products: CounterProduct[] }) {
  const [lines, setLines] = useState<Line[]>([{ productId: "", quantity: 1 }]);
  const [method, setMethod] = useState("cash");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [discount, setDiscount] = useState("");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [pending, start] = useTransition();
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const shown = products.filter((p) => !search || `${p.name} ${p.sku}`.toLowerCase().includes(search.toLowerCase()));
  const subtotal = lines.reduce((s, l) => s + (byId.get(l.productId)?.price ?? 0) * l.quantity, 0);
  const total = Math.max(0, subtotal - (Number(discount) || 0));
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = () => start(async () => {
    const items = lines.filter((l) => l.productId);
    const res = await recordInStoreSale({ items, paymentMethod: method, customerName: name, customerPhone: phone, discount: Number(discount) || 0, note, key });
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(`Sale ${res.orderNumber} recorded — ${etb(res.total)}. Stock updated.`);
    setLines([{ productId: "", quantity: 1 }]); setName(""); setPhone(""); setDiscount(""); setNote(""); setKey(crypto.randomUUID());
  });

  return (
    <div className="space-y-4" data-testid="instore-form">
      <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a product (name or SKU)…" aria-label="Find a product" className={`${fieldClass} max-w-sm`} />
      <ul className="space-y-2">
        {lines.map((l, i) => {
          const p = byId.get(l.productId);
          return (
            <li key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_7rem_8rem_auto]">
              <label className="text-xs">Product
                <select value={l.productId} onChange={(e) => set(i, { productId: e.target.value })} className={`${fieldClass} mt-1`} aria-label={`Product ${i + 1}`}>
                  <option value="">Choose…</option>
                  {(p && !shown.includes(p) ? [p, ...shown] : shown).map((x) => (
                    <option key={x.id} value={x.id} disabled={x.stock === 0}>{x.name} · {x.sku} · {etb(x.price)}{x.stock !== null ? ` · ${x.stock} in stock` : ""}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs">Quantity
                <input type="number" min={1} max={p?.stock ?? 1000} value={l.quantity} onChange={(e) => set(i, { quantity: Math.max(1, Number(e.target.value) || 1) })} className={`${fieldClass} mt-1`} aria-label={`Quantity ${i + 1}`} />
              </label>
              <p className="pb-2 text-sm tabular-nums">{p ? etb(p.price * l.quantity) : "—"}</p>
              <Button type="button" variant="ghost" size="icon" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 /></Button>
            </li>
          );
        })}
      </ul>
      <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, { productId: "", quantity: 1 }])}><Plus /> Add product</Button>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">Paid by
          <select value={method} onChange={(e) => setMethod(e.target.value)} className={`${fieldClass} mt-1`} name="paymentMethod">
            <option value="cash">Cash</option><option value="mobile_money">Mobile money (e.g. telebirr)</option><option value="bank_transfer">Bank transfer</option>
          </select>
        </label>
        <label className="text-sm">Discount (ETB, optional)<input type="number" min={0} step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} className={`${fieldClass} mt-1`} /></label>
        <label className="text-sm">Customer name (optional)<input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Walk-in customer" className={`${fieldClass} mt-1`} /></label>
        <label className="text-sm">Customer phone (optional)<input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} placeholder="0911 234 567" className={`${fieldClass} mt-1`} /></label>
      </div>
      <label className="block text-sm">Note (optional)<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={`${fieldClass} mt-1`} /></label>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/60 p-3">
        <p className="text-sm">Total: <strong className="text-lg tabular-nums">{etb(total)}</strong>{Number(discount) > 0 && <span className="text-muted-foreground"> (subtotal {etb(subtotal)})</span>}</p>
        <Button type="button" onClick={submit} disabled={pending || !lines.some((l) => l.productId)}>{pending && <Loader2 className="animate-spin" />} Record sale</Button>
      </div>
      <p className="text-xs text-muted-foreground">The sale is saved as paid and completed, stock goes down right away, and it counts in Orders, Analytics and Sales reports (marked “In store”). Prices are today&apos;s shop prices.</p>
    </div>
  );
}
