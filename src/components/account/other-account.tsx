import { getTranslations } from "next-intl/server";
import { UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { switchCustomerAccount } from "@/lib/account/actions";

/** Shown when a signed-in customer opens an order/job that belongs to a different account. */
export async function OtherAccountNotice({ email, next }: { email: string; next: string }) {
  const t = await getTranslations("account");
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-24 text-center">
      <UserX className="size-10 text-muted-foreground" aria-hidden />
      <p className="font-medium">{t("otherAccountTitle")}</p>
      <p className="text-sm text-muted-foreground">{t("otherAccountText", { email })}</p>
      <form action={switchCustomerAccount}>
        <input type="hidden" name="next" value={next} />
        <Button type="submit">{t("otherAccountSwitch")}</Button>
      </form>
    </div>
  );
}
