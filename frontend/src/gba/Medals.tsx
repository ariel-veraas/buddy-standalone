import { type Medal } from "./training";

/** Insignia original geométrica, con silueta para las medallas pendientes. */
export function MedalIcon({ earned }: { earned: boolean }) {
  return <svg class={`gba-medal-icon ${earned ? "earned" : "locked"}`} viewBox="0 0 32 40" aria-hidden="true"><path d="M8 2h6l2 10 2-10h6l-4 16h-8z" fill="currentColor"/><path d="M10 15h12l6 6v10l-6 7H10l-6-7V21z" fill="currentColor"/>{earned && <path d="m11 26 4 4 7-9" fill="none" stroke="var(--sheet)" stroke-width="3"/>}</svg>;
}
export function Medals({ medals }: { medals: Medal[] }) {
  return <section class="gba-medals" aria-labelledby="medals-title"><h2 id="medals-title">Medallas</h2><p class="muted">Logros que nacen de mejoras comprobadas.</p><div class="gba-medal-grid">{medals.map((m) => <article class={`gba-medal ${m.earned ? "" : "locked"}`} key={m.id}><MedalIcon earned={m.earned}/><h3>{m.name}</h3><p>{m.desc}</p><strong>{m.earned ? "Conseguida" : `${Math.min(m.progress, m.target)} / ${m.target}`}</strong></article>)}</div></section>;
}
