"use client";
import { useEffect, useState, useTransition } from "react";
import { Star, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { deleteReview, getMyReview, saveReview, type MyReview } from "@/lib/catalog/review-actions";
import { cn } from "@/lib/utils";

/** "Write a review" for customers who received the product; shows their review's status. */
export function ReviewBox({ productId }: { productId: string }) {
  const t = useTranslations("reviews");
  const [me, setMe] = useState<MyReview | null>(null);
  const [editing, setEditing] = useState(false);
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    getMyReview(productId).then((r) => {
      if (!live) return;
      setMe(r);
      if (r.review) { setRating(r.review.rating); setBody(r.review.body ?? ""); }
    }, () => {});
    return () => { live = false; };
  }, [productId]);

  if (!me || !me.signedIn || (!me.eligible && !me.review)) return null;

  const submit = () =>
    start(async () => {
      if (rating < 1) { toast.error(t("chooseStars")); return; }
      const res = await saveReview(productId, rating, body);
      if (!res.ok) { toast.error(t(`errors.${res.error ?? "failed"}`)); return; }
      setMe({ ...me, review: { rating, body: body.trim() || null, status: "pending", note: null } });
      setEditing(false);
      toast.success(t("sent"));
    });
  const remove = () =>
    start(async () => {
      if (!window.confirm(t("deleteConfirm"))) return;
      const res = await deleteReview(productId);
      if (res.ok) { setMe({ ...me, review: null }); setRating(0); setBody(""); toast.success(t("deleted")); }
    });

  if (me.review && !editing) {
    const r = me.review;
    return (
      <div className="space-y-2 rounded-lg border bg-muted/40 p-4 text-sm" data-testid="my-review">
        <p className="font-medium">{t("yourReview")}</p>
        <p className="flex items-center gap-0.5" aria-label={t("ratingLabel", { rating: r.rating })}>
          {[1, 2, 3, 4, 5].map((i) => <Star key={i} aria-hidden className={cn("size-4", i <= r.rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")} />)}
        </p>
        {r.body && <p className="whitespace-pre-line">{r.body}</p>}
        <p className={cn("text-xs", r.status === "rejected" ? "text-destructive" : "text-muted-foreground")}>
          {t(`status.${r.status}`)}{r.status === "rejected" && r.note ? ` — ${r.note}` : ""}
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditing(true)} disabled={pending}>{t("edit")}</Button>
          <Button size="sm" variant="ghost" onClick={remove} disabled={pending}><Trash2 /> {t("delete")}</Button>
        </div>
      </div>
    );
  }
  return (
    <form className="space-y-3 rounded-lg border p-4" onSubmit={(e) => { e.preventDefault(); submit(); }} data-testid="review-form">
      <p className="font-medium">{t("write")}</p>
      <fieldset>
        <legend className="mb-1 text-sm text-muted-foreground">{t("yourRating")}</legend>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((i) => (
            <button key={i} type="button" onClick={() => setRating(i)} aria-label={t("stars", { count: i })} aria-pressed={rating === i}
              className="rounded p-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              <Star aria-hidden className={cn("size-7", i <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/50")} />
            </button>
          ))}
        </div>
      </fieldset>
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} rows={3} placeholder={t("placeholder")} aria-label={t("comment")} />
      <p className="text-xs text-muted-foreground">{t("moderated")}</p>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{t("submit")}</Button>
        {editing && <Button type="button" variant="ghost" onClick={() => setEditing(false)}>{t("cancel")}</Button>}
      </div>
    </form>
  );
}
