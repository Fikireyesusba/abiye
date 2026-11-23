import { redirect } from "next/navigation";

/** Tracking now lives in My orders (a Track button on every order). Old links still work. */
export default function TrackOrderPage() {
  redirect("/account/orders");
}
