import { useState } from "preact/hooks";
import { del, get, post, put } from "../api";
import { ConfirmButton, Field, Loading, Modal, fail, toast, useLoad } from "../ui";
import "../quality.css";

type Window = { total: number; answered: number; unsure: number; undocumented: number; error: number };
type Gap = { key: string; terms: string[]; count: number; status: "open" | "returned"; examples: string[]; raw_examples: string[] };
type Case = { id: number; question: string; document_id: number | null; document: string; origin: string; last_ok: boolean | null; last_checked: string | null };
type Run = { at: string; passed: number; total: number; config: string; regressions: number };
type Data = { honesty: { days: number; current: Window; previous: Window; tickets_open: number }; gaps: { groups: Gap[]; ungrouped: number; read: number }; cases: Case[]; history: Run[] };
type Doc = { id: number; name: string };

const pct = (n: number, total: number) => (total ? Math.round((n * 100) / total) : 0);
const when = (iso: string) => new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function Quality() {
  const [days, setDays] = useState(30);
  const data = useLoad(() => get<Data>(`/api/quality?days=${days}`), [days]);
  const docs = useLoad(() => get<Doc[]>("/api/quality/documents"));
  const d = data.data;
  return (
    <div class="page">
      <div class="page-head">
        <div><h1>Calidad</h1><p>Qué le falta saber a Buddy, y si hoy encuentra lo que ya cargaste.</p></div>
        <label class="field" style="min-width:11rem"><span class="sr-only">Período</span>
          <select class="input" value={days} onChange={(e) => setDays(+(e.target as HTMLSelectElement).value)}>
            <option value={7}>Últimos 7 días</option><option value={30}>Últimos 30 días</option><option value={90}>Últimos 90 días</option>
          </select>
        </label>
      </div>
      <Loading error={data.error} loading={data.loading && !d} retry={data.reload} />
      {d && <Honesty h={d.honesty} />}
      {d && <Gaps gaps={d.gaps} docs={docs.data ?? []} onChange={data.reload} />}
      {d && <Tests data={d} docs={docs.data ?? []} onChange={(next) => data.setData({ ...d, ...next })} />}
    </div>
  );
}

function Honesty({ h }: { h: Data["honesty"] }) {
  const c = h.current, p = h.previous;
  if (!c.total) {
    return <section class="stack"><h2>Cómo responde</h2><div class="empty"><h3>Todavía no hay consultas en este período</h3><p>Cuando tu equipo pregunte, acá vas a ver cuánto responde con respaldo y cuánto no sabe.</p></div></section>;
  }
  const rows: [string, number, string, number][] = [
    ["Respondió con respaldo", c.answered, "ok", p.total ? pct(c.answered, c.total) - pct(p.answered, p.total) : 0],
    ["Respondió con dudas", c.unsure, "doubt", p.total ? pct(c.unsure, c.total) - pct(p.unsure, p.total) : 0],
    ["No estaba documentado", c.undocumented, "bad", p.total ? pct(c.undocumented, c.total) - pct(p.undocumented, p.total) : 0],
  ];
  return (
    <section class="stack" aria-labelledby="q-h">
      <h2 id="q-h">Cómo responde</h2>
      <p class="muted">Cuando no sabe, Buddy lo dice y no inventa. Este es el reparto de las {c.total} consultas del período.</p>
      <div class="honesty-bar" role="img" aria-label={rows.map((r) => `${r[0]}: ${pct(r[1], c.total)}%`).join(". ")}>
        {rows.map((r) => <i key={r[0]} class={r[2]} style={{ width: `${pct(r[1], c.total)}%` }} />)}
      </div>
      <div class="figures">
        {rows.map(([label, n, tone, delta]) => (
          <div class="figure" key={label}>
            <b class={`tone-${tone}`}>{pct(n, c.total)}%</b>
            <span>{label}{p.total > 0 && delta !== 0 ? ` (${delta > 0 ? "+" : ""}${delta} puntos que el período anterior)` : ""}</span>
          </div>
        ))}
        {h.tickets_open > 0 && <div class="figure"><b>{h.tickets_open}</b><span>tickets abiertos para una persona</span></div>}
      </div>
    </section>
  );
}

function Gaps({ gaps, docs, onChange }: { gaps: Data["gaps"]; docs: Doc[]; onChange: () => void }) {
  const [target, setTarget] = useState<Gap | null>(null);
  const ignore = async (g: Gap) => { try { await put(`/api/quality/gaps/${encodeURIComponent(g.key)}`, { state: "ignored" }); toast("Tema ignorado."); onChange(); } catch (e) { fail(e); } };
  return (
    <section class="stack" aria-labelledby="g-h">
      <h2 id="g-h">Qué falta documentar</h2>
      <p class="muted">Temas que la gente preguntó y Buddy no pudo responder. Cargá un documento que lo explique y marcalo como listo: Buddy verifica que ahora lo encuentre.</p>
      {gaps.groups.length === 0 && (
        <div class="empty"><h3>No hay temas pendientes</h3><p>{gaps.read ? "Todo lo que la gente preguntó y no estaba documentado ya quedó resuelto o ignorado." : "Las preguntas que Buddy no pueda responder van a aparecer acá, agrupadas por tema."}</p></div>
      )}
      <ul class="gap-list">
        {gaps.groups.map((g) => (
          <li key={g.key} class="gap">
            <div class="gap-main">
              <div class="row">
                <h3>{g.terms.join(" · ")}</h3>
                <span class="pill">{g.count} {g.count === 1 ? "pregunta" : "preguntas"}</span>
                {g.status === "returned" && <span class="pill warn">Siguen preguntando aunque lo marcaste como listo</span>}
              </div>
              <ul class="examples">{g.examples.map((e) => <li key={e}>{e}</li>)}</ul>
            </div>
            <div class="row">
              <button class="btn small" onClick={() => setTarget(g)}>Ya lo documenté</button>
              <ConfirmButton class="btn quiet small" label="Ignorar" title="Ignorar este tema" message="Deja de aparecer en la lista. No se borra nada." confirmLabel="Ignorar" onConfirm={() => ignore(g)} />
            </div>
          </li>
        ))}
      </ul>
      {gaps.ungrouped > 0 && <p class="faint">Hay {gaps.ungrouped} preguntas sueltas que no se parecen entre sí.</p>}
      {target && <Resolve gap={target} docs={docs} onClose={() => setTarget(null)} onDone={() => { setTarget(null); onChange(); }} />}
    </section>
  );
}

function Resolve({ gap, docs, onClose, onDone }: { gap: Gap; docs: Doc[]; onClose: () => void; onDone: () => void }) {
  const [doc, setDoc] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await put(`/api/quality/gaps/${encodeURIComponent(gap.key)}`, { state: "resolved", document_id: doc ? +doc : null, questions: doc ? gap.raw_examples : [] });
      toast(doc ? "Listo. Quedó en las pruebas: probalas para confirmar que Buddy lo encuentra." : "Marcado como documentado.");
      onDone();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Ya documenté «${gap.terms[0]}»`} onClose={onClose} actions={<><button class="btn" onClick={onClose}>Cancelar</button><button class="btn primary" disabled={busy} onClick={submit}>Marcar como listo</button></>}>
      <Field label="¿En qué documento quedó?" id="gap-doc" hint="Si lo elegís, esas preguntas pasan a las pruebas y Buddy verifica que encuentre ese documento. Podés dejarlo vacío.">
        <select id="gap-doc" class="input" value={doc} onChange={(e) => setDoc((e.target as HTMLSelectElement).value)}>
          <option value="">No sé / lo cargué en otro lado</option>
          {docs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </Field>
    </Modal>
  );
}

function Tests({ data, docs, onChange }: { data: Data; docs: Doc[]; onChange: (next: Partial<Data>) => void }) {
  const [question, setQuestion] = useState("");
  const [doc, setDoc] = useState("");
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<{ passed: number; total: number; regressions: number } | null>(null);
  const add = async (e: Event) => {
    e.preventDefault();
    try { const r = await post("/api/quality/cases", { question, document_id: doc ? +doc : null }); onChange({ cases: r.cases }); setQuestion(""); setDoc(""); } catch (err) { fail(err); }
  };
  const run = async () => {
    setRunning(true);
    try { const r = await post("/api/quality/run"); onChange({ cases: r.cases, history: r.history }); setSummary(r); } catch (err) { fail(err); } finally { setRunning(false); }
  };
  const remove = async (id: number) => { try { const r = await del(`/api/quality/cases/${id}`); onChange({ cases: r.cases }); } catch (err) { fail(err); } };
  const last = data.history[0], before = data.history[1];
  return (
    <section class="stack" aria-labelledby="t-h">
      <div class="page-head">
        <div><h2 id="t-h">Pruebas de calidad</h2><p class="muted">Preguntas que Buddy tiene que saber encontrar. Se verifica la búsqueda, sin usar la IA, así que no cuesta nada y podés correrlas cada vez que cambies documentos o ajustes.</p></div>
        <button class="btn primary" disabled={running || data.cases.length === 0} onClick={run}>{running ? "Probando…" : "Probar ahora"}</button>
      </div>
      {summary && (
        <div class={`note ${summary.passed === summary.total ? "good" : "warn"}`} role="status">
          Pasaron {summary.passed} de {summary.total}.{summary.regressions > 0 ? ` ${summary.regressions} dejaron de funcionar desde la última vez.` : ""}
        </div>
      )}
      {data.cases.length === 0 && <div class="empty"><h3>Todavía no hay preguntas de prueba</h3><p>Se suman solas cuando marcás un tema como documentado, o podés agregar una abajo.</p></div>}
      <ul class="case-list">
        {data.cases.map((c) => (
          <li key={c.id}>
            <span class={`pill ${c.last_ok === null ? "" : c.last_ok ? "ok" : "bad"}`}>{c.last_ok === null ? "Sin probar" : c.last_ok ? "Lo encuentra" : "No lo encuentra"}</span>
            <span class="grow"><b>{c.question}</b>{c.document ? <span class="faint"> en {c.document}</span> : c.document_id ? <span class="faint"> en un documento que ya no existe</span> : <span class="faint"> en cualquier documento</span>}</span>
            <button class="btn quiet small" aria-label={`Quitar la pregunta «${c.question}»`} onClick={() => remove(c.id)}>Quitar</button>
          </li>
        ))}
      </ul>
      <form class="case-form" onSubmit={add}>
        <Field label="Agregar una pregunta" id="case-q"><input id="case-q" class="input" minLength={3} maxLength={500} required value={question} onInput={(e) => setQuestion((e.target as HTMLInputElement).value)} placeholder="¿Cuántos días de vacaciones me tocan?" /></Field>
        <Field label="Dónde debería estar la respuesta" id="case-d">
          <select id="case-d" class="input" value={doc} onChange={(e) => setDoc((e.target as HTMLSelectElement).value)}>
            <option value="">En cualquier documento</option>
            {docs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
        <button class="btn">Agregar</button>
      </form>
      {last && (
        <div class="history">
          <h3>Historial</h3>
          {last && before && <p class="faint">{last.passed >= before.passed ? "Igual o mejor" : "Peor"} que la corrida anterior ({before.passed} de {before.total} antes, {last.passed} de {last.total} ahora).</p>}
          <ul>{data.history.map((r) => <li key={r.at}><b>{r.passed} de {r.total}</b><span class="faint"> · {when(r.at)} · {r.config}</span></li>)}</ul>
        </div>
      )}
    </section>
  );
}
