#!/usr/bin/env bash
# Start the LOCAL development backend (Docker + Supabase). Safe to run repeatedly.
# Only needed for local development; production uses hosted Supabase + Vercel.
set -euo pipefail

if ! docker info >/dev/null 2>&1; then
  if command -v dockerd >/dev/null 2>&1 && [ "$(id -u)" = "0" ]; then
    echo "Docker daemon not running — starting it (sandbox/Linux root)…"
    nohup dockerd >/tmp/dockerd.log 2>&1 &
    for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
  fi
  docker info >/dev/null 2>&1 || { echo "Docker is not running. Start Docker Desktop (or the docker service) and retry."; exit 1; }
fi

# Skip services this project does not use (the local mail catcher stays on for sign-up emails).
npx supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor,realtime >/dev/null

KEY="${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:-$(grep -E '^NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=' .env.local 2>/dev/null | cut -d= -f2)}"
# The API can answer 503 for a few seconds after (re)starting: retry for up to ~90 s.
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:54321/rest/v1/products?select=id&limit=1" -H "apikey: ${KEY}")
  [ "$code" = "200" ] && break
  sleep 3
done
[ "$code" = "200" ] && echo "Local Supabase is ready." || { echo "Supabase API check failed (HTTP $code)"; exit 1; }
