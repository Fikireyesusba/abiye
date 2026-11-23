/** Light / dark theme chosen on the Profile page, remembered in a cookie on the device. */
export type ThemeChoice = "light" | "dark" | "system";
export const THEME_COOKIE = "theme";
export const themeFromCookie = (raw: string | undefined): ThemeChoice => (raw === "dark" || raw === "system" ? raw : "light");
