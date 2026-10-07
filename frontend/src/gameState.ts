import { useEffect, useState } from "preact/hooks";
import { get } from "./api";
import { DEFAULT_PREFS, type Prefs } from "./buddy/personality";
import type { Growth } from "./gba/XpBar";
import { configureSound, unlockSound } from "./gba/sound";
import { loadGameFont } from "./gba/font";

export function publishGamePrefs(prefs: Prefs) {
  window.dispatchEvent(new CustomEvent("buddy-prefs", { detail: prefs }));
}

/** El XP siempre viene del servidor; una consulta nunca modifica esta barra. */
export function useGameState(userId?: number) {
  const [growth, setGrowth] = useState<Growth | null>(null);
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  useEffect(() => {
    setGrowth(null); setPrefs(DEFAULT_PREFS);
    if (!userId) return;
    let active = true;
    let prefsChanged = false;
    const refresh = () => get<Growth>("/api/growth").then((next) => {
      if (!active) return;
      setGrowth(next);
    }).catch(() => {});
    get("/api/chat/config").then((cfg) => { if (active && !prefsChanged) setPrefs({ ...DEFAULT_PREFS, ...cfg.prefs }); }).catch(() => {});
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    const onFocus = () => refresh();
    const onPrefs = (e: Event) => { prefsChanged = true; setPrefs((e as CustomEvent<Prefs>).detail); };
    window.addEventListener("focus", onFocus);
    window.addEventListener("buddy-growth", onFocus);
    window.addEventListener("buddy-prefs", onPrefs);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", onFocus); window.removeEventListener("buddy-growth", onFocus); window.removeEventListener("buddy-prefs", onPrefs); };
  }, [userId]);
  useEffect(() => {
    document.documentElement.dataset.gba = prefs.gba ? "on" : "off";
    configureSound(prefs.sound);
    if (prefs.gba) loadGameFont();
  }, [prefs.gba, prefs.sound]);
  useEffect(() => {
    const gesture = () => unlockSound();
    window.addEventListener("pointerdown", gesture);
    window.addEventListener("keydown", gesture);
    return () => { window.removeEventListener("pointerdown", gesture); window.removeEventListener("keydown", gesture); };
  }, []);
  return { growth, prefs };
}


