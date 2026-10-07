import { STAGE_NAMES, xpPercentage, type Growth } from "./helpers";
export type { Growth } from "./helpers";
export function XpBar({ growth, compact = false }: { growth: Growth; compact?: boolean }) {
  const percentage = xpPercentage(growth.xp_into_level, growth.xp_for_next);
  return <div class={`gba-xp ${compact ? "gba-xp-compact" : ""}`}>
    <div class="gba-xp-label"><strong>Nv. {growth.level}</strong><span>{STAGE_NAMES[growth.stage]}</span><small>{growth.xp_into_level} / {growth.xp_for_next} XP</small></div>
    <div class="gba-xp-track" role="progressbar" aria-label="Experiencia de mejoras verificadas de la empresa" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} aria-valuetext={`${growth.xp_into_level} de ${growth.xp_for_next} XP para el próximo nivel`}><i style={{ width: "100%", transform: `scaleX(${percentage / 100})`, transformOrigin: "left" }} /></div>
    {!compact && <p class="muted">Buddy crece con las mejoras verificadas de tu equipo.</p>}
  </div>;
}
