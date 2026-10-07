import { useEffect, useRef, useState } from "preact/hooks";
import { Modal, toast } from "../ui";
import { DialogBox } from "./DialogBox";
import type { Growth } from "./helpers";
import { detectMedals } from "./training";
import { playSound } from "./sound";

export function GrowthMoments({ userId, growth, sound, hold = false }: { userId: number; growth: Growth; sound: boolean; hold?: boolean }) {
  const [lines, setLines] = useState<string[]>([]);
  const level = useRef<number | null>(null);
  useEffect(() => {
    if (hold) return; // la evolución va primero; los avisos esperan
    const moments: string[] = [];
    if (level.current !== null && growth.level > level.current) moments.push(`¡Buddy subió al nivel ${growth.level}! Tu equipo logró nuevas mejoras verificadas.`);
    level.current = growth.level;
    let storage: Storage | undefined;
    try { storage = window.localStorage; } catch { /* El almacenamiento no impide usar Buddy. */ }
    for (const medal of detectMedals(userId, growth.medals ?? [], storage)) { moments.push(`¡Medalla conseguida: ${medal.name}! ${medal.desc}`); toast(`Medalla conseguida: ${medal.name}`); }
    if (moments.length) { setLines(moments); if (sound) playSound("level"); }
  }, [userId, growth.level, JSON.stringify(growth.medals), hold]);
  if (!lines.length) return null;
  return <Modal title="¡Buddy sigue creciendo!" onClose={() => setLines([])} actions={<button class="btn" onClick={() => setLines([])}>Cerrar</button>}><DialogBox lines={lines} sound={sound} onComplete={() => setLines([])}/></Modal>;
}
