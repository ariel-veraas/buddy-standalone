import { useEffect } from "preact/hooks";
import { get } from "../api";
import { Loading, useLoad } from "../ui";
import { loadGameFont } from "./font";
import { xpPercentage } from "./helpers";
import { PixelBuddy } from "./sprites";
import { XpBar, type Growth } from "./XpBar";

type Dex = { registered: { key: string; note: string; changed_at: string; verified: boolean }[]; unknown: { key: string; terms: string[]; count: number }[]; total_seen: number; completion: number };
export function Buddydex() {
  const data = useLoad(() => get<Dex>("/api/growth/dex")), dex = data.data;
  const growth = useLoad(() => get<Growth>("/api/growth"));
  useEffect(() => { void loadGameFont(); }, []);
  return <div class="page gba-dex">
    <div class="page-head"><div><h1>Buddydex</h1><p>Cada tema documentado abre una nueva entrada.</p></div><a class="btn" href="/admin/calidad">Documentar temas</a></div>
    <Loading loading={data.loading && !dex} error={data.error} retry={data.reload} />
    {growth.data && <section class="gba-dex-summary"><XpBar growth={growth.data} /></section>}
    {dex && <>
      <section class="gba-dex-summary" aria-label="Temas registrados"><h2>Registrados {dex.registered.length} de {dex.total_seen}</h2><div class="gba-xp-track" role="progressbar" aria-label="Temas registrados" aria-valuemin={0} aria-valuemax={dex.total_seen || 1} aria-valuenow={dex.registered.length}><i style={{ width: `${xpPercentage(dex.registered.length, dex.total_seen)}%` }} /></div><p class="muted">La marca ✓ indica que una prueba confirmó que Buddy encuentra el tema.</p></section>
      {!dex.total_seen && <div class="empty"><PixelBuddy stage="egg" idle={false} /><h2>Buddy tiene mucho por aprender</h2><p>Cuando tu equipo pregunte, los temas que faltan aparecerán acá. Documentalos y comprobá las respuestas en Calidad.</p><a href="/admin/calidad">Ir a Calidad</a></div>}
      <div class="gba-dex-grid">
        {dex.registered.map((entry) => <article class="gba-dex-entry" key={`known:${entry.key}`}><span class="gba-dex-mark" aria-hidden="true">{entry.verified ? "✓" : "◇"}</span><h2>{entry.note || entry.key}</h2><p class="muted">{entry.verified ? "Documentado y verificado" : "Documentado · pendiente de verificar"}</p></article>)}
        {dex.unknown.map((entry) => <a class="gba-dex-entry gba-dex-unknown" key={`unknown:${entry.key}`} href="/admin/calidad" aria-label={`Tema por documentar. ${entry.count} ${entry.count === 1 ? "pregunta sin respuesta" : "preguntas sin respuesta"}. Abrir Calidad`}><PixelBuddy stage="cria" silhouette idle={false} size={64} /><h2>???</h2><p>{entry.count} {entry.count === 1 ? "pregunta sin respuesta" : "preguntas sin respuesta"}</p><span>Documentar en Calidad →</span></a>)}
      </div>
    </>}
  </div>;
}
