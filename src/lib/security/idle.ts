/** Inactivity sign-out (minutes). Shared by the proxy (server check) and the browser timer. */
// Couriers keep the app open on the road: a longer inactivity limit than the admin portal.
export const IDLE_MINUTES = { admin: 8, customer: 20, courier: 30 } as const;
/** Last real user activity (ms since epoch), written by the browser timer; readable by the proxy. */
export const ACTIVE_COOKIE = "abiye_active";
/** Session the activity cookie belongs to (set by the proxy, httpOnly). A new sign-in starts fresh. */
export const SESSION_COOKIE = "abiye_sid";
