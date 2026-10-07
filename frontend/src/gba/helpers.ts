export const STAGES = ["egg", "cria", "joven", "adulto", "legendario"] as const;
export type Stage = typeof STAGES[number];
export const STAGE_NAMES: Record<Stage, string> = { egg: "Huevo", cria: "Cría", joven: "Joven", adulto: "Adulto", legendario: "Legendario" };
export interface Growth { xp: number; level: number; xp_into_level: number; xp_for_next: number; stage: Stage; medals?: import("./training").Medal[]; }
export function xpPercentage(into: number, next: number) {
  return Number.isFinite(into) && Number.isFinite(next) && next > 0 ? Math.max(0, Math.min(100, into / next * 100)) : 0;
}
export function typewriterStep(length: number, elapsed: number, reduced: boolean, interval = 30) {
  return reduced ? length : Math.min(length, Math.max(0, Math.floor(elapsed / interval)));
}
export function detectEvolution(userId: number | string, stage: Stage, storage?: Pick<Storage, "getItem" | "setItem">): Stage | null {
  try {
    const saved = storage?.getItem(`buddy-stage:${userId}`);
    storage?.setItem(`buddy-stage:${userId}`, stage);
    return saved && STAGES.includes(saved as Stage) && STAGES.indexOf(stage) > STAGES.indexOf(saved as Stage) ? saved as Stage : null;
  } catch { return null; }
}
