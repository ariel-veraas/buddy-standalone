import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { Mood } from "./species";
import { line, type Species } from "./personality";

const SLEEP_AFTER_MS = 60_000;
const IDLE_LINE_AFTER_MS = 28_000;
const POKE_WINDOW_MS = 4_000;
const DIZZY_AT = 8;

export type Burst = { kind: "hearts" | "stars" | "zzz"; k: number };

/** Estado "vivo" del personaje: ánimo, frase, ojos que siguen el cursor, sueño y reacciones a los toques. */
export function useCompanion(species: Species, name: string) {
  const [base, setBase] = useState<Mood>("wave");
  const [flash, setFlash] = useState<Mood | null>(null);
  const [asleep, setAsleep] = useState(false);
  const [say, setSayText] = useState("");
  const [burst, setBurst] = useState<Burst>({ kind: "hearts", k: 0 });
  const [look, setLook] = useState<{ x: number; y: number } | null>(null);
  const [typing, setTyping] = useState(false);
  const el = useRef<HTMLElement | null>(null);
  const timers = useRef<{ flash?: number; say?: number; sleep?: number; idle?: number }>({});
  const pokes = useRef<number[]>([]);
  const last = useRef("");
  const asleepRef = useRef(false);
  const idleSaid = useRef(0);

  const speak = useCallback((text: string, ms = 4200) => {
    if (!text) return;
    last.current = text;
    setSayText(text);
    clearTimeout(timers.current.say);
    timers.current.say = window.setTimeout(() => setSayText(""), ms);
  }, []);

  const react = useCallback((mood: Mood, ms = 2600, text?: string) => {
    setFlash(mood);
    clearTimeout(timers.current.flash);
    timers.current.flash = window.setTimeout(() => setFlash(null), ms);
    if (text) speak(text);
  }, [speak]);

  const said = useCallback((kind: Parameters<typeof line>[1], extra: Parameters<typeof line>[2] = {}) =>
    line(species, kind, { name, hour: new Date().getHours(), last: last.current, ...extra }), [species, name]);

  const celebrate = useCallback((kind: Burst["kind"]) => setBurst((b) => ({ kind, k: b.k + 1 })), []);

  /** Cualquier actividad de la persona: despierta y reinicia los relojes de sueño. */
  const activity = useCallback(() => {
    clearTimeout(timers.current.sleep);
    clearTimeout(timers.current.idle);
    if (asleepRef.current) {
      asleepRef.current = false; setAsleep(false);
      react("surprised", 1600);
    }
    if (idleSaid.current < 2) timers.current.idle = window.setTimeout(() => { idleSaid.current += 1; speak(said("idle"), 5000); }, IDLE_LINE_AFTER_MS * (idleSaid.current + 1));
    timers.current.sleep = window.setTimeout(() => {
      asleepRef.current = true; setAsleep(true); setSayText("");
      celebrate("zzz");
    }, SLEEP_AFTER_MS);
  }, [react, said, speak, celebrate]);

  useEffect(() => {
    activity();
    const onActive = () => activity();
    window.addEventListener("keydown", onActive);
    window.addEventListener("pointerdown", onActive);
    window.addEventListener("scroll", onActive, { capture: true, passive: true });
    return () => {
      window.removeEventListener("keydown", onActive); window.removeEventListener("pointerdown", onActive); window.removeEventListener("scroll", onActive, { capture: true });
      Object.values(timers.current).forEach((t) => clearTimeout(t));
    };
  }, [activity]);

  // Los ojos siguen el cursor (como mucho ~12 veces por segundo).
  useEffect(() => {
    let frame = 0, lastRun = 0;
    const onMove = (e: PointerEvent) => {
      const now = performance.now();
      if (frame || now - lastRun < 80 || !el.current || document.hidden || asleepRef.current) return;
      frame = requestAnimationFrame(() => {
        frame = 0; lastRun = performance.now();
        const r = el.current?.getBoundingClientRect();
        if (!r) return;
        const dx = (e.clientX - (r.left + r.width / 2)) / 260, dy = (e.clientY - (r.top + r.height / 2)) / 260;
        const clamp = (n: number) => Math.round(Math.max(-1, Math.min(1, n)) * 10) / 10;
        setLook({ x: clamp(dx), y: clamp(dy) });
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => { window.removeEventListener("pointermove", onMove); cancelAnimationFrame(frame); };
  }, []);

  const poke = useCallback(() => {
    const now = Date.now();
    pokes.current = [...pokes.current.filter((t) => now - t < POKE_WINDOW_MS), now];
    const n = pokes.current.length;
    if (n >= DIZZY_AT) {
      pokes.current = [];
      react("dizzy", 3200, said("dizzy"));
    } else if (n >= 4) {
      react("surprised", 1800, said("poke", { n }));
    } else {
      react("happy", 1800, said("poke", { n }));
      if (n === 3) celebrate("hearts");
    }
  }, [react, said, celebrate]);

  const effective: Mood = asleep ? "sleepy" : flash ?? base;
  const gaze = typing && !asleep ? { x: 0, y: 0.9 } : look;
  return { mood: effective, setBase, react, speak, said, celebrate, burst, say, look: gaze, typing, setTyping, poke, el, asleep, activity };
}
