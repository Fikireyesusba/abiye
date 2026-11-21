/**
 * What counts as an ACTIVE security alert (red, in the badge): any suspicious email (a failed
 * sign-in, wrong code, rate limit …) that is not blocked and not reviewed since, and any suspicious
 * customer not blocked / deactivated. Reviewed ones leave the lists until something new happens.
 */
export const isEmailAlert = (e: { score: number | string; blocked: boolean }) => Number(e.score) > 0 && !e.blocked;
export const isCustomerAlert = (c: { blocked: boolean; deactivated: boolean }) => !c.blocked && !c.deactivated;
/** A score this high is shown as "high risk" (several failed attempts / networks). */
export const HIGH_RISK = 6;
