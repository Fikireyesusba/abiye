import "server-only";
import { normalizeEthiopianPhone } from "@/lib/validation/phone";
import { getCustomerAccount } from "./session";

/**
 * Name and phone for an order or printing job: always the ones on the account (never the browser's).
 * Only a value the account does not have yet (e.g. a phone never given) is taken from the form,
 * and is then saved to the account once (it is locked after that).
 */
export async function accountContact(userId: string, submitted: { fullName: string; phone: string }) {
  const account = await getCustomerAccount(userId);
  const name = account?.full_name?.trim() || null;
  const phone = account?.phone || null;
  return {
    fullName: name ?? submitted.fullName,
    phone: phone ?? (normalizeEthiopianPhone(submitted.phone) ?? submitted.phone),
    /** Missing details to store on the account (set once). */
    save: { ...(name ? {} : { full_name: submitted.fullName }), ...(phone ? {} : { phone: normalizeEthiopianPhone(submitted.phone) ?? submitted.phone }) },
  };
}
