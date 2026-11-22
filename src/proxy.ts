import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { buildContentSecurityPolicy } from "@/lib/security/csp";
import { ACTIVE_COOKIE, IDLE_MINUTES, SESSION_COOKIE } from "@/lib/security/idle";

/** Paths that read the Supabase session (cookie refresh needed). */
const SESSION_PATHS = [/^\/track-order$/, /^\/support(\/|$)/, /^\/admin(\/|$)/, /^\/account(\/|$)/, /^\/checkout$/, /^\/order-success\//, /^\/printing(\/|$)/];

/**
 * Runs before every page:
 *   1. Content-Security-Policy with a fresh nonce per request. Next.js reads
 *      the nonce from the request's CSP header and adds it to its own scripts.
 *   2. Session pages: refreshes the Supabase session cookie (required by
 *      @supabase/ssr) so server components always see a valid session.
 *   3. /admin only: bounces unauthenticated visitors to /admin/login early.
 *
 * Step 3 is a convenience gate, NOT the security boundary. Every admin page,
 * server action and route handler re-checks auth + permissions server-side
 * (src/lib/auth/guards.ts), and the database enforces RLS.
 */
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isAdmin = /^\/admin(\/|$)/.test(path);
  const isLogin = path === "/admin/login";
  const needsSession = SESSION_PATHS.some((re) => re.test(path));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const nonce = btoa(crypto.randomUUID());
  const csp = buildContentSecurityPolicy({ nonce, supabaseUrl: url, dev: process.env.NODE_ENV === "development" });

  const cookiesToSet: { name: string; value: string; options?: Parameters<NextResponse["cookies"]["set"]>[2] }[] = [];
  const extraHeaders: Record<string, string> = {};
  let signedIn = false;
  let sessionId: string | null = null;
  let supabaseClient: ReturnType<typeof createServerClient> | null = null;
  if (needsSession && url && key) {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(list, headers) {
          // Updating request.cookies also updates the request's Cookie header (forwarded below).
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          cookiesToSet.push(...list);
          Object.assign(extraHeaders, headers ?? {});
        },
      },
    });
    const { data } = await supabase.auth.getClaims();
    signedIn = !!data?.claims?.sub;
    sessionId = typeof data?.claims?.session_id === "string" ? data.claims.session_id : null;
    supabaseClient = supabase;
  }

  // Inactivity sign-out (server side; the browser timer does the same while a tab is open).
  const isAnyLogin = isLogin || path === "/account/login";
  // Long-lived on purpose: after days away the old activity time must still be there, so the visit counts as idle (not a fresh start).
  const cookieOpts = { path: "/", sameSite: "lax" as const, secure: request.nextUrl.protocol === "https:", maxAge: 30 * 86400 };
  // One device per account: a newer sign-in elsewhere ended this session → sign out here too.
  // (An error, e.g. before the database update, never blocks: the database enforces it as well.)
  const ended = needsSession && signedIn && sessionId && !isAnyLogin && supabaseClient
    ? (await supabaseClient.rpc("session_is_current")).data === false
    : false;
  if (ended) {
    await supabaseClient?.auth.signOut({ scope: "local" });
    cookiesToSet.push({ name: SESSION_COOKIE, value: "", options: { ...cookieOpts, maxAge: 0 } });
    cookiesToSet.push({ name: ACTIVE_COOKIE, value: "", options: { ...cookieOpts, maxAge: 0 } });
    const login = new URL(isAdmin ? "/admin/login" : "/account/login", request.url);
    login.searchParams.set("reason", "elsewhere");
    if (!isAdmin) login.searchParams.set("next", path);
    const response = NextResponse.redirect(login);
    cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
    Object.entries(extraHeaders).forEach(([k, v]) => response.headers.set(k, v));
    response.headers.set("Content-Security-Policy", csp);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  if (needsSession && signedIn && sessionId && !isAnyLogin) {
    const limitMs = (isAdmin ? IDLE_MINUTES.admin : IDLE_MINUTES.customer) * 60_000;
    const last = Number(request.cookies.get(ACTIVE_COOKIE)?.value);
    if (request.cookies.get(SESSION_COOKIE)?.value !== sessionId || !Number.isFinite(last) || last <= 0) {
      // New sign-in (or first visit since): start counting now.
      cookiesToSet.push({ name: SESSION_COOKIE, value: sessionId, options: { ...cookieOpts, httpOnly: true } });
      cookiesToSet.push({ name: ACTIVE_COOKIE, value: String(Date.now()), options: { ...cookieOpts, httpOnly: false } });
    } else if (Date.now() - last > limitMs) {
      await supabaseClient?.auth.signOut({ scope: "local" });
      cookiesToSet.push({ name: SESSION_COOKIE, value: "", options: { ...cookieOpts, maxAge: 0 } });
      cookiesToSet.push({ name: ACTIVE_COOKIE, value: "", options: { ...cookieOpts, maxAge: 0 } });
      const login = new URL(isAdmin ? "/admin/login" : "/account/login", request.url);
      login.searchParams.set("reason", "idle");
      if (!isAdmin) login.searchParams.set("next", path);
      signedIn = false;
      const response = NextResponse.redirect(login);
      cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      Object.entries(extraHeaders).forEach(([k, v]) => response.headers.set(k, v));
      response.headers.set("Content-Security-Policy", csp);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
  } else if (needsSession && !signedIn && request.cookies.get(ACTIVE_COOKIE)) {
    cookiesToSet.push({ name: ACTIVE_COOKIE, value: "", options: { ...cookieOpts, maxAge: 0 } });
    cookiesToSet.push({ name: SESSION_COOKIE, value: "", options: { ...cookieOpts, maxAge: 0 } });
  }

  const finish = (response: NextResponse) => {
    cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
    Object.entries(extraHeaders).forEach(([k, v]) => response.headers.set(k, v));
    response.headers.set("Content-Security-Policy", csp);
    if (needsSession) response.headers.set("Cache-Control", "private, no-store");
    if (isAdmin) response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  };

  // Admin: fail closed when misconfigured; bounce signed-out visitors to the login page.
  if (isAdmin && !isLogin && (!url || !key || !signedIn)) {
    const login = new URL("/admin/login", request.url);
    if (url && key) login.searchParams.set("next", path);
    return finish(NextResponse.redirect(login));
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  return finish(NextResponse.next({ request: { headers: requestHeaders } }));
}

export const config = {
  matcher: [
    {
      // Every page; not API routes, build assets, image optimizer or static files.
      source: "/((?!api/|_next/static|_next/image|favicon\\.ico|icon|apple-icon|robots\\.txt|sitemap\\.xml|sw\\.js|manifest\\.webmanifest|app-icon/|.*\\.(?:png|jpg|jpeg|gif|svg|webp|avif|ico|txt|xml|webmanifest)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
