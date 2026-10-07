import { useEffect, useState } from "preact/hooks";
import { get, post, put } from "../api";
import { Field, Loading, fail, toast, useLoad } from "../ui";
import { XpBar, type Growth } from "../gba/XpBar";
import { Medals } from "../gba/Medals";
import { loadGameFont } from "../gba/font";
import { variantRows, weekLabel, type Draft, type Synonym, type WeeklySummary } from "../gba/training";

type Collection = { id: number; name: string; kind: string; active?: boolean; can_edit?: boolean };
export function Training() {
  const weekly = useLoad(() => get<{ last: WeeklySummary | null; history: WeeklySummary[] }>("/api/growth/weekly"));
  const drafts = useLoad(() => get<Draft[]>("/api/growth/drafts?state=pending"));
  const synonyms = useLoad(() => get<Synonym[]>("/api/growth/synonyms?state=pending"));
  const collections = useLoad(() => get<Collection[]>("/api/collections"));
  const growth = useLoad(() => get<Growth>("/api/growth"));
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<number | null>(null);
  useEffect(() => { void loadGameFont(); }, []);
  const reload = () => { void weekly.reload(); void drafts.reload(); void synonyms.reload(); void growth.reload(); window.dispatchEvent(new Event("buddy-growth")); };
  const train = async () => {
    setBusy(true); setError(null);
    try { await post("/api/growth/weekly/run"); reload(); toast("Sesión de entrenamiento lista."); }
    catch (e) { setError(e instanceof Error ? e.message : "No pude entrenar. Probá de nuevo."); }
    finally { setBusy(false); }
  };
  const reviewSynonym = async (id: number, state: string) => {
    setReviewing(id);
    try { await put(`/api/growth/synonyms/${id}`, { state }); reload(); toast(state === "approved" ? "Sinónimo incorporado." : "Propuesta rechazada."); }
    catch (e) { fail(e); } finally { setReviewing(null); }
  };
  const last = weekly.data?.last;
  return <div class="page gba-training">
    <div class="page-head"><div><h1>Entrenamiento</h1><p>Buddy propone. Tu equipo revisa y decide qué aprende.</p></div><button class="btn primary" disabled={busy || weekly.loading} onClick={train}>{busy ? "Entrenando…" : "Entrenar ahora"}</button></div>
    <Loading loading={weekly.loading && !weekly.data} error={weekly.error} retry={weekly.reload}/>
    {error && <p class="note bad" role="alert">{error}</p>}
    {last ? <section class="gba-training-results" aria-labelledby="session-title"><h2 id="session-title">Sesión de entrenamiento — {weekLabel(last.week)}</h2><div class="gba-training-score"><strong>Nivel {last.level_before} → {last.level_after}</strong><span>+{last.xp_gained} XP verificados</span><span>{last.topics_registered} temas registrados</span><span>{last.medals_earned?.length ?? 0} medallas conseguidas</span></div>{last.growth_after && <SessionXp key={last.week + last.xp_gained} before={last.growth_before} after={last.growth_after}/>}<p>{last.summary}</p><p class="note"><span><b>Uso de IA:</b> {last.ai.message} · {last.ai.calls} llamadas. Las etapas sin IA se realizan aunque no haya proveedor o se alcance el tope de gasto o cupo.</span></p></section> : !weekly.loading && !weekly.error && <section class="empty"><h2>La primera sesión está por empezar</h2><p>Entrená para revisar oportunidades reales. Los borradores necesitan una respuesta o nota escrita por tu equipo en un ticket resuelto.</p></section>}
    {growth.data?.medals && <Medals medals={growth.data.medals}/>}
    <section class="gba-review" aria-labelledby="draft-title"><h2 id="draft-title">Borradores</h2><p class="muted">Revisá el texto y elegí dónde publicarlo. El XP llega cuando la prueba de calidad confirma la mejora.</p><Loading loading={drafts.loading && !drafts.data} error={drafts.error} retry={drafts.reload}/>{drafts.data?.length === 0 && <p class="note">No hay borradores pendientes. Las respuestas humanas de tickets resueltos pueden convertirse en propuestas en la próxima sesión.</p>}{drafts.data?.map((draft) => <DraftReview key={draft.id} draft={draft} collections={(collections.data ?? []).filter((c) => c.kind === "upload" && c.active !== false && c.can_edit !== false)} onSaved={reload}/>)}<Loading loading={collections.loading} error={collections.error} retry={collections.reload}/></section>
    <section class="gba-review" aria-labelledby="synonym-title"><h2 id="synonym-title">Sinónimos propuestos</h2><p class="muted">Conectá el vocabulario de las preguntas con el de tus documentos.</p><Loading loading={synonyms.loading && !synonyms.data} error={synonyms.error} retry={synonyms.reload}/>{synonyms.data?.length === 0 && <p class="note">Por ahora no hay términos para revisar.</p>}<div class="list">{synonyms.data?.map((s) => <article class="item" key={s.id}><div><h3>{s.term} → {s.suggested}</h3><p class="muted">{s.count} apariciones en consultas sin respuesta clara</p></div><div class="actions"><button class="btn primary small" disabled={reviewing !== null} onClick={() => reviewSynonym(s.id,"approved")}>{reviewing === s.id ? "Guardando…" : "Aprobar"}</button><button class="btn small" disabled={reviewing !== null} onClick={() => reviewSynonym(s.id,"rejected")}>Rechazar</button></div></article>)}</div></section>
    <section class="gba-review" aria-labelledby="experiment-title"><h2 id="experiment-title">Experimento de ajustes</h2><p>Estos resultados no cambian la configuración. Si elegís una variante, aplicala vos en Ajustes{ " "}<span class="muted">(solo administradores).</span></p>{last?.variants?.length ? <div class="gba-variant-scroll"><table class="gba-variants"><caption>Pruebas de calidad por cantidad de fragmentos recuperados</caption><thead><tr><th scope="col">top_k</th><th scope="col">Pruebas verdes</th><th scope="col">Resultado</th></tr></thead><tbody>{variantRows(last.variants).map((v) => <tr key={v.top_k}><th scope="row">{v.top_k}</th><td>{v.result}</td><td>{v.best ? "Mejor puntaje" : "Comparación"}</td></tr>)}</tbody></table></div> : <p class="note">El experimento necesita casos de calidad. Agregalos en Calidad y volvé a entrenar.</p>}</section>
    {!!weekly.data?.history.length && <section class="gba-review"><h2>Sesiones anteriores</h2><ul class="gba-session-history">{weekly.data.history.map((s) => <li key={s.week}><strong>{weekLabel(s.week)}</strong><p>{s.summary}</p></li>)}</ul></section>}
  </div>;
}
function DraftReview({ draft, collections, onSaved }: { draft: Draft; collections: Collection[]; onSaved: () => void }) {
  const [title, setTitle] = useState(draft.title), [body, setBody] = useState(draft.body), [collection, setCollection] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const review = async (state: string) => {
    setBusy(true); setError(null);
    try { await put(`/api/growth/drafts/${draft.id}`, state === "approved" ? { state, title, body, collection_id: Number(collection) } : { state }); onSaved(); toast(state === "approved" ? "Documento creado. La próxima prueba verificará la mejora." : "Borrador rechazado."); }
    catch (e) { setError(e instanceof Error ? e.message : "No pude guardar la revisión."); } finally { setBusy(false); }
  };
  return <article class="gba-draft"><h3>Propuesta del ticket #{draft.ticket_id}</h3><Field label="Título" id={`draft-title-${draft.id}`}><input class="input" id={`draft-title-${draft.id}`} value={title} maxLength={300} onInput={(e) => setTitle(e.currentTarget.value)}/></Field><Field label="Texto del borrador" id={`draft-body-${draft.id}`}><textarea class="input" id={`draft-body-${draft.id}`} rows={7} value={body} maxLength={6000} onInput={(e) => setBody(e.currentTarget.value)}/></Field><Field label="Colección de destino" id={`draft-collection-${draft.id}`} hint="Se aplican los permisos y la visibilidad de esta colección."><select class="input" id={`draft-collection-${draft.id}`} value={collection} onChange={(e) => setCollection(e.currentTarget.value)}><option value="">Elegí una colección</option>{collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>{!collections.length && <p class="muted">Necesitás una colección de subida manual que puedas editar.</p>}<p class="muted">Revisá que no haya datos de personas: al aprobar, el texto queda visible para quien pueda leer esa colección.</p>{error && <p class="note bad" role="alert">{error}</p>}<div class="actions"><button class="btn primary" disabled={busy || !collection || !title.trim() || !body.trim()} onClick={() => review("approved")}>{busy ? "Guardando…" : "Aprobar y publicar"}</button><button class="btn" disabled={busy} onClick={() => review("rejected")}>Rechazar</button></div></article>;
}


function SessionXp({ before, after }: { before?: Growth; after: Growth }) {
  const [shown, setShown] = useState(before ?? after);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) { setShown(after); return; }
    const timer = window.setTimeout(() => setShown(after), 100);
    return () => window.clearTimeout(timer);
  }, [before, after]);
  return <XpBar growth={shown}/>;
}
