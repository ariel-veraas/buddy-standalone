import { useEffect, useRef, useState } from "preact/hooks";
import type { Species } from "../buddy/species";
import { DialogBox } from "./DialogBox";
import { detectEvolution, STAGE_NAMES, type Stage } from "./helpers";
import { PixelBuddy } from "./sprites";
import { playSound } from "./sound";
import { loadGameFont } from "./font";

export function Evolution({ userId, stage, species, color, sound = false, onBusy }: { userId: number | string; stage: Stage; species: Species; color?: string; sound?: boolean; onBusy?: (busy: boolean) => void }) {
  const [previous, setPrevious] = useState<Stage | null>(null), [changed, setChanged] = useState(false);
  const close = useRef<HTMLButtonElement>(null), priorFocus = useRef<HTMLElement | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let storage: Storage | undefined;
    try { storage = window.localStorage; } catch { /* La evolución no impide usar la app. */ }
    setPrevious(detectEvolution(userId, stage, storage)); setChanged(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, [userId, stage]);
  useEffect(() => { onBusy?.(previous !== null); }, [previous]);
  const dismiss = () => { setPrevious(null); priorFocus.current?.focus(); };
  useEffect(() => {
    if (!previous) return;
    void loadGameFont();
    priorFocus.current = document.activeElement as HTMLElement;
    close.current?.focus();
    if (sound) playSound("evolution");
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
      if (e.key === "Tab") {
        const buttons = Array.from(surface.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [previous]);
  if (!previous) return null;
  return <div ref={surface} class="gba-evolution" role="dialog" aria-modal="true" aria-label="Buddy está evolucionando" onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}>
    <div class="gba-evolution-content">
      <button ref={close} type="button" class="btn gba-evolution-close" onClick={dismiss}>Omitir evolución</button>
      <div class="gba-evolution-art"><PixelBuddy stage={changed ? stage : previous} species={species} color={color} size={240} /></div>
      <DialogBox lines={["¿Qué? ¡Buddy está evolucionando!", `¡Buddy ahora es ${STAGE_NAMES[stage].toLowerCase()}!`]} sound={sound} onLineChange={() => setChanged(true)} onComplete={dismiss} />
      <p class="muted">Podés cerrar con Esc.</p>
    </div>
  </div>;
}
