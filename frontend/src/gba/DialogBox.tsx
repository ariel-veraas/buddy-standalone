import { useEffect, useRef, useState } from "preact/hooks";
import { loadGameFont } from "./font";
import { typewriterStep } from "./helpers";
import { playSound, unlockSound } from "./sound";

export function DialogBox({ lines, sound = false, onComplete, onLineChange }: { lines: string[]; sound?: boolean; onComplete?: () => void; onLineChange?: (index: number) => void }) {
  const signature = JSON.stringify(lines);
  const [line, setLine] = useState(0), [count, setCount] = useState(0);
  const timerRef = useRef<number | undefined>(undefined);
  const text = lines[line] ?? "";
  useEffect(() => { void loadGameFont(); setLine(0); setCount(0); }, [signature]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const start = performance.now();
    setCount(media.matches ? text.length : 0);
    const finish = () => { if (media.matches) { setCount(text.length); window.clearInterval(timerRef.current); } };
    media.addEventListener("change", finish);
    const timer = window.setInterval(() => {
      const next = typewriterStep(text.length, performance.now() - start, media.matches);
      setCount((current) => Math.max(current, next));
      if (next >= text.length) window.clearInterval(timer);
      else if (sound && !media.matches) playSound("tick");
    }, 30);
    timerRef.current = timer;
    if (media.matches) window.clearInterval(timer);
    return () => { window.clearInterval(timer); media.removeEventListener("change", finish); };
  }, [text, line, signature, sound]);
  const advance = () => {
    unlockSound();
    if (count < text.length) { window.clearInterval(timerRef.current); setCount(text.length); }
    else if (line < lines.length - 1) { setLine(line + 1); onLineChange?.(line + 1); }
    else onComplete?.();
  };
  return <button type="button" class="gba-dialog" onClick={advance} aria-label={`${text}. ${count < text.length ? "Mostrar texto completo" : line < lines.length - 1 ? "Continuar" : "Listo"}`}>
    <span aria-live="polite" aria-atomic="true"><span aria-hidden="true">{text.slice(0, count)}</span><span class="sr-only">{text}</span></span>
    {count >= text.length && <span class="gba-next" aria-hidden="true">▼</span>}
  </button>;
}
