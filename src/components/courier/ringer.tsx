"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BellRing } from "lucide-react";

const ACK = "courier:ack-assigned";
const readAck = () => { try { return Number(localStorage.getItem(ACK) ?? 0); } catch { return 0; } };
const writeAck = (id: number) => { try { localStorage.setItem(ACK, String(id)); } catch {} };

/**
 * Rings when a new delivery is assigned (checks every 20 s while the app is open): the Super Admin's ringtone,
 * or a built-in ring; the phone also vibrates. Rings until the courier taps the banner.
 */
export function CourierRinger({ latestAssigned, ringtoneUrl }: { latestAssigned: number | null; ringtoneUrl: string | null }) {
  const router = useRouter();
  const [ringing, setRinging] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const beep = useRef<number | null>(null);

  // Look for new deliveries regularly (server data refresh).
  useEffect(() => {
    const t = window.setInterval(() => router.refresh(), 20_000);
    return () => window.clearInterval(t);
  }, [router]);

  useEffect(() => {
    if (!latestAssigned || latestAssigned <= readAck()) return;
    queueMicrotask(() => setRinging(true));
  }, [latestAssigned]);

  useEffect(() => {
    if (!ringing) return;
    navigator.vibrate?.([600, 300, 600, 300, 600]);
    if (ringtoneUrl) {
      const a = new Audio(ringtoneUrl);
      a.loop = true;
      audio.current = a;
      void a.play().catch(() => {}); // a browser may block sound until the screen is touched once
    } else {
      // Built-in ring: two short tones every 1.5 s.
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      const ctx = Ctx ? new Ctx() : null;
      const ring = () => {
        if (!ctx) return;
        [0, 0.25].forEach((at) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.frequency.value = 880;
          g.gain.value = 0.2;
          o.connect(g).connect(ctx.destination);
          o.start(ctx.currentTime + at);
          o.stop(ctx.currentTime + at + 0.18);
        });
      };
      ring();
      beep.current = window.setInterval(ring, 1500);
    }
    return () => {
      audio.current?.pause();
      audio.current = null;
      if (beep.current) window.clearInterval(beep.current);
      navigator.vibrate?.(0);
    };
  }, [ringing, ringtoneUrl]);

  if (!ringing) return null;
  return (
    <button type="button" data-testid="ringing"
      onClick={() => { if (latestAssigned) writeAck(latestAssigned); setRinging(false); router.push("/courier"); }}
      className="fixed inset-x-4 top-16 z-50 flex animate-pulse items-center gap-3 rounded-2xl bg-primary p-4 text-left text-primary-foreground shadow-xl">
      <BellRing className="size-8 shrink-0" aria-hidden />
      <span><span className="block text-lg font-semibold">New delivery!</span><span className="block text-sm opacity-90">Tap to open it.</span></span>
    </button>
  );
}
