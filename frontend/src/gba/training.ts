export type Medal = { id: string; name: string; desc: string; earned: boolean; progress: number; target: number };
export type Variant = { top_k: number; passed: number; total: number };
export type WeeklySummary = { week: string; level_before: number; level_after: number; xp_gained: number; topics_registered: number; drafts_pending: number; proposals_pending: number; summary: string; medals?: Medal[]; medals_earned?: Medal[]; growth_before?: import("./helpers").Growth; growth_after?: import("./helpers").Growth; ai: { calls: number; status: string; message: string }; variants: Variant[] };
export type Draft = { id: number; ticket_id: number; title: string; body: string; state: string };
export type Synonym = { id: number; term: string; suggested: string; count: number; state: string };

export function medalDiff(medals: Medal[], seen: string[]): Medal[] {
  return medals.filter((m) => m.earned && !seen.includes(m.id));
}
/** Una primera visita registra el estante sin repetir premios históricos. */
export function detectMedals(userId: number | string, medals: Medal[], storage?: Pick<Storage, "getItem" | "setItem">): Medal[] {
  try {
    const key = `buddy-medals:${userId}`, saved = storage?.getItem(key);
    const seen: unknown = saved ? JSON.parse(saved) : null;
    storage?.setItem(key, JSON.stringify(medals.filter((m) => m.earned).map((m) => m.id)));
    return Array.isArray(seen) && seen.every((id) => typeof id === "string") ? medalDiff(medals, seen) : [];
  } catch { return []; }
}
export function weekLabel(week: string) {
  const match = /^(\d{4})-W(\d{2})$/.exec(week);
  return match ? `Semana ${Number(match[2])} · ${match[1]}` : "Sesión semanal";
}
export function variantRows(variants: Variant[]) {
  const best = Math.max(-1, ...variants.map((v) => v.passed));
  return variants.map((v) => ({ ...v, best: v.passed === best, result: `${v.passed} / ${v.total}` }));
}
