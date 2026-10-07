import { useState } from "preact/hooks";
import { get } from "../api";
import { navigate } from "../router";
import { Loading, num, useLoad } from "../ui";

type Stats = {
  days: number; total: number; by_outcome: Record<string, number>; avg_latency_ms: number; tokens_in: number; tokens_out: number;
  per_day: { day: string; count: number }[]; unanswered: { question: string; count: number }[];
  feedback: { up: number; down: number }; tickets_open: number;
};
type Down = { day: string; reason: string | null; model: string | null; question: string | null };

const REASON: Record<string, string> = { not_asked: "No era lo que preguntó", wrong: "Dato incorrecto o desactualizado", incomplete: "Incompleta", other: "Otro" };

export function Overview() {
  const [days, setDays] = useState(30);
  const stats = useLoad(() => get<Stats>(`/api/admin/stats?days=${days}`), [days]);
  const down = useLoad(() => get<Down[]>("/api/admin/feedback"));
  const s = stats.data;
  const peak = Math.max(1, ...(s?.per_day.map((d) => d.count) ?? [1]));
  const answered = s?.by_outcome.answered ?? 0;

  return (
    <div class="page">
      <div class="page-head">
        <div><h1>Resumen</h1><p>Cómo se usa Buddy y qué preguntas no pudo resolver.</p></div>
        <label class="field" style="min-width:11rem"><span class="sr-only">Período</span>
          <select class="input" value={days} onChange={(e) => setDays(+(e.target as HTMLSelectElement).value)}>
            <option value={7}>Últimos 7 días</option><option value={30}>Últimos 30 días</option><option value={90}>Últimos 90 días</option>
          </select>
        </label>
      </div>
      <Loading error={stats.error} loading={stats.loading && !s} retry={stats.reload} />
      {s && s.total === 0 && (
        <div class="empty"><h3>Todavía no hay consultas</h3><p>Cuando tu equipo empiece a preguntar vas a ver acá cuánto lo usan y qué temas faltan documentar.</p><button class="btn" onClick={() => navigate("/")}>Probar a Buddy</button></div>
      )}
      {s && s.total > 0 && (
        <>
          <div class="figures">
            <div class="figure"><b>{num(s.total)}</b><span>consultas</span></div>
            <div class="figure"><b>{Math.round((answered / s.total) * 100)}%</b><span>respondidas con documentos</span></div>
            <div class="figure"><b>{num(s.by_outcome.undocumented ?? 0)}</b><span>sin documentar</span></div>
            <div class="figure"><b>{(s.avg_latency_ms / 1000).toFixed(1)} s</b><span>tiempo medio de respuesta</span></div>
            <div class="figure"><b>{num(s.tokens_in + s.tokens_out)}</b><span>tokens usados</span></div>
          </div>
          <section class="stack" aria-label="Consultas por día">
            <h2>Consultas por día</h2>
            <div class="bars" role="img" aria-label={`Consultas por día; el máximo fue ${peak}`}>
              {s.per_day.map((d) => <div key={d.day} style={{ height: `${(d.count / peak) * 100}%` }} title={`${d.day}: ${d.count}`} />)}
            </div>
          </section>
          <section class="stack">
            <h2>Preguntas sin respuesta en los documentos</h2>
            {s.unanswered.length === 0 ? <p class="muted">Ninguna en este período. Buddy encontró respuesta para todo.</p> : (
              <>
                <p class="muted">Son los temas que la gente busca y todavía no están documentados.</p>
                <div class="list">{s.unanswered.map((u, i) => <div class="item" key={i}><span class="title">{u.question}</span><span class="pill">{u.count} {u.count === 1 ? "vez" : "veces"}</span></div>)}</div>
              </>
            )}
          </section>
        </>
      )}
      <section class="stack">
        <h2>Valoraciones</h2>
        {s && <p class="muted">👍 {s.feedback.up} · 👎 {s.feedback.down}. Los votos son anónimos: no se sabe quién votó.</p>}
        {down.data && down.data.length === 0 && <p class="muted">Todavía nadie marcó una respuesta como no útil.</p>}
        {!!down.data?.length && <div class="list">{down.data.map((d, i) => <div class="item" key={i}><div><span class="title">{d.question ?? "(pregunta no guardada)"}</span><div class="meta"><span>{d.day}</span>{d.reason && <span>{REASON[d.reason] ?? d.reason}</span>}{d.model && <span>{d.model}</span>}</div></div></div>)}</div>}
      </section>
      {s && s.tickets_open > 0 && <div class="note warn"><span>Hay {s.tickets_open} {s.tickets_open === 1 ? "ticket abierto" : "tickets abiertos"}.</span><button class="btn small" onClick={() => navigate("/admin/soporte")}>Ver tickets</button></div>}
    </div>
  );
}
