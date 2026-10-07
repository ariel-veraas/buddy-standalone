import { useEffect, useState } from "preact/hooks";
import { del, get, post, put } from "../api";
import { PersonalityPicker } from "../buddy/PersonalityPicker";
import { refreshBrand } from "../session";
import { Check, ConfirmButton, Field, Loading, fail, num, toast, useLoad } from "../ui";

type S = Record<string, any>;
type Semantic = { enabled: boolean; available: boolean; supported: boolean; model: string | null; pending: number };

export function Settings() {
  const loaded = useLoad(() => get<S>("/api/admin/settings"));
  const semantic = useLoad(() => get<Semantic>("/api/admin/semantic"));
  const [form, setForm] = useState<S>({});
  const [apiKey, setApiKey] = useState("");
  const [driveKey, setDriveKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<any>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => { if (loaded.data) setForm(loaded.data); }, [loaded.data]);
  const set = (key: string, value: unknown) => setForm((f) => ({ ...f, [key]: value }));
  const text = (key: string) => (e: Event) => set(key, (e.target as HTMLInputElement).value);

  if (!loaded.data) return <div class="page"><Loading error={loaded.error} loading={loaded.loading} retry={loaded.reload} /></div>;
  const original = loaded.data;
  const dirty = apiKey || driveKey || Object.keys(form).some((k) => !["providers", "api_key_set", "drive_key_set", "drive_email"].includes(k) && form[k] !== original[k]);

  const save = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body: S = {};
      for (const k of Object.keys(form)) if (!["providers", "api_key_set", "drive_key_set", "drive_email"].includes(k) && form[k] !== original[k]) body[k] = form[k];
      if (apiKey) body.api_key = apiKey;
      if (driveKey) body.drive_key = driveKey;
      const next = await put<S>("/api/admin/settings", body);
      loaded.setData(next); setApiKey(""); setDriveKey(""); setTest(null);
      semantic.reload();
      refreshBrand();
      toast("Ajustes guardados.");
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const runTest = async () => {
    setTesting(true); setTest(null);
    try { setTest(await post("/api/admin/settings/test")); } catch (err) { fail(err); } finally { setTesting(false); }
  };

  const providerName = form.providers?.[form.provider] ?? form.provider;
  const sem = semantic.data;

  return (
    <form class="page" onSubmit={save}>
      <div class="page-head">
        <div><h1>Ajustes</h1><p>Acá conectás el proveedor de IA y definís cómo se comporta Buddy.</p></div>
        <button class="btn primary" disabled={busy || !dirty}>{busy ? "Guardando…" : "Guardar cambios"}</button>
      </div>

      <PersonalityPicker form={form} set={set} />

      <section class="stack" aria-labelledby="s-ia">
        <h2 id="s-ia">Proveedor de IA</h2>
        <div class="fields">
          <Field label="Proveedor" id="provider">
            <select id="provider" class="input" value={form.provider} onChange={text("provider")}>
              {Object.entries(form.providers ?? {}).map(([id, name]) => <option key={id} value={id}>{name as string}</option>)}
            </select>
          </Field>
          <Field label="API key" id="api_key" hint={form.api_key_set ? "Hay una clave guardada y cifrada. Nadie puede volver a verla; escribí otra para reemplazarla." : `Pegá la API key de ${providerName}. Se guarda cifrada y nunca se vuelve a mostrar.${form.provider === "custom" ? " Si tu servidor (por ejemplo Ollama) no usa clave, escribí cualquier texto." : ""}`}>
            <input id="api_key" class="input" type="password" autocomplete="off" placeholder={form.api_key_set ? "•••••••••• (guardada)" : ""} value={apiKey} onInput={(e) => setApiKey((e.target as HTMLInputElement).value)} />
          </Field>
          <Field label="Modelo" id="chat_model" hint="Si lo dejás vacío se usa el recomendado del proveedor."><input id="chat_model" class="input" value={form.chat_model} onInput={text("chat_model")} /></Field>
          {form.provider === "custom" && <Field label="Dirección del servicio" id="api_base" hint="URL base compatible con OpenAI, por ejemplo https://mi-servidor/v1"><input id="api_base" class="input" value={form.api_base} onInput={text("api_base")} /></Field>}
        </div>
        <div class="row">
          <button type="button" class="btn" disabled={testing || !!dirty || !form.api_key_set} onClick={runTest}>{testing ? "Probando…" : "Probar conexión"}</button>
          {dirty && <span class="faint">Guardá los cambios antes de probar.</span>}
          {form.api_key_set && <ConfirmButton label="Quitar la API key" title="Quitar la API key" message="Buddy deja de poder responder hasta que cargues otra." confirmLabel="Quitar" onConfirm={async () => { try { await del("/api/admin/settings/secret/api_key"); loaded.reload(); toast("API key quitada."); } catch (err) { fail(err); } }} />}
        </div>
        {test && (test.ok
          ? <div class="note good" role="status"><span>Funciona. Modelo «{test.model}» respondió. {test.models?.length ? `Modelos disponibles: ${test.models.join(", ")}.` : ""}</span></div>
          : <div class="note bad" role="alert"><span>No funcionó: {test.message}{test.models?.length ? ` Modelos que ve tu cuenta: ${test.models.join(", ")}.` : ""}</span></div>)}
      </section>

      <section class="stack" aria-labelledby="s-bd">
        <h2 id="s-bd">Cómo se presenta Buddy</h2>
        <div class="fields">
          <Field label="Nombre del asistente" id="buddy_name"><input id="buddy_name" class="input" maxLength={80} value={form.buddy_name} onInput={text("buddy_name")} /></Field>
          <Field label="Nombre de tu empresa" id="company" hint="Aparece en saludos y en el texto de ayuda."><input id="company" class="input" maxLength={160} value={form.company} onInput={text("company")} /></Field>
          <Field label="Cómo habla" id="dialect">
            <select id="dialect" class="input" value={form.dialect} onChange={text("dialect")}><option value="rioplatense">Español rioplatense (vos)</option><option value="neutral">Español neutro (tú)</option></select>
          </Field>
        </div>
        <Field label="Indicaciones extra" id="extra" hint="Reglas propias de tu empresa, por ejemplo «Tratá siempre de usted a los clientes». Máximo 1500 caracteres."><textarea id="extra" class="input" maxLength={1500} value={form.extra_instructions} onInput={text("extra_instructions")} /></Field>
        <Field label="Sinónimos propios" id="synonyms" hint="Una línea por grupo, palabras separadas por coma. Ejemplo: vacaciones, licencia, días libres"><textarea id="synonyms" class="input" maxLength={6000} value={form.synonyms} onInput={text("synonyms")} /></Field>
      </section>

      <section class="stack" aria-labelledby="s-sem">
        <h2 id="s-sem">Búsqueda por significado</h2>
        <p class="muted">Además de las palabras, Buddy entiende la idea de la pregunta (“¿puedo faltar para rendir un examen?” encuentra la política de licencias). Está apagada de fábrica.</p>
        <Check checked={form.semantic_search === "1"} onChange={(v) => set("semantic_search", v ? "1" : "0")} label="Activar la búsqueda por significado"
          hint="Para calcularla se envía el texto de todos los documentos de las colecciones activas al proveedor de IA, también los de colecciones restringidas." />
        {form.semantic_search === "1" && (
          <>
            {sem && !sem.supported && <div class="note warn">{providerName} no ofrece esta función. Elegí otro proveedor para usarla.</div>}
            <div class="fields">
              <Field label="Modelo de vectores" id="embedding_model" hint="Vacío = el recomendado del proveedor."><input id="embedding_model" class="input" value={form.embedding_model} onInput={text("embedding_model")} /></Field>
              <Field label="Tamaño del vector" id="embedding_dims" hint="0 = el recomendado."><input id="embedding_dims" class="input" inputMode="numeric" value={form.embedding_dims} onInput={text("embedding_dims")} /></Field>
            </div>
            {sem?.available && (
              <div class="row">
                <span class={`pill ${sem.pending ? "warn" : "ok"}`}>{sem.pending ? `${num(sem.pending)} fragmentos sin calcular` : "Todo al día"}</span>
                {sem.pending > 0 && <button type="button" class="btn small" disabled={!!dirty} onClick={async () => { try { await post("/api/admin/semantic/index"); toast("Calculando en segundo plano. Podés seguir usando Buddy."); setTimeout(semantic.reload, 4000); } catch (err) { fail(err); } }}>Calcular ahora</button>}
                <span class="faint">Los fragmentos nuevos se calculan solos al subir o sincronizar.</span>
              </div>
            )}
          </>
        )}
      </section>

      <section class="stack" aria-labelledby="s-drive">
        <h2 id="s-drive">Google Drive</h2>
        <p class="muted">Para traer documentos de carpetas de Drive necesitás una cuenta de servicio de Google con acceso de solo lectura.</p>
        <Field label="Clave de la cuenta de servicio (JSON)" id="drive_key" hint={form.drive_key_set ? `Cargada${form.drive_email ? ` (${form.drive_email})` : ""}. Compartí cada carpeta con ese email. Pegá otro JSON para reemplazarla.` : "Pegá el contenido completo del archivo .json que descargaste de Google Cloud."}>
          <textarea id="drive_key" class="input" autocomplete="off" spellcheck={false} placeholder={form.drive_key_set ? "(guardada y cifrada)" : '{ "type": "service_account", … }'} value={driveKey} onInput={(e) => setDriveKey((e.target as HTMLTextAreaElement).value)} />
        </Field>
        <div class="fields">
          <Field label="Sincronizar cada (horas)" id="sync_hours"><input id="sync_hours" class="input" inputMode="numeric" value={form.sync_hours} onInput={text("sync_hours")} /></Field>
        </div>
        {form.drive_key_set && <div><ConfirmButton label="Quitar la clave de Drive" title="Quitar la clave de Drive" message="Las colecciones de Drive dejan de sincronizarse. Los documentos ya cargados se conservan." confirmLabel="Quitar" onConfirm={async () => { try { await del("/api/admin/settings/secret/drive_key"); loaded.reload(); toast("Clave quitada."); } catch (err) { fail(err); } }} /></div>}
      </section>

      <section class="stack" aria-labelledby="s-lim">
        <h2 id="s-lim">Límites y privacidad</h2>
        <div class="fields">
          <Field label="Consultas por minuto, por persona" id="rpm"><input id="rpm" class="input" inputMode="numeric" value={form.rate_per_minute} onInput={text("rate_per_minute")} /></Field>
          <Field label="Consultas por día, por persona" id="rpd"><input id="rpd" class="input" inputMode="numeric" value={form.rate_per_day} onInput={text("rate_per_day")} /></Field>
          <Field label="Tope diario de toda la empresa" id="mdt" hint="Frena una factura inesperada con tu proveedor."><input id="mdt" class="input" inputMode="numeric" value={form.max_daily_total} onInput={text("max_daily_total")} /></Field>
          <Field label="Consultas al mismo tiempo" id="mc"><input id="mc" class="input" inputMode="numeric" value={form.max_concurrent} onInput={text("max_concurrent")} /></Field>
          <Field label="Fragmentos que lee por consulta" id="topk" hint="Entre 1 y 10. Más fragmentos dan más contexto y cuestan más."><input id="topk" class="input" inputMode="numeric" value={form.top_k} onInput={text("top_k")} /></Field>
          <Field label="Preguntas de una persona nueva" id="nut" hint="Durante sus primeras preguntas Buddy explica con más detalle."><input id="nut" class="input" inputMode="numeric" value={form.new_user_turns} onInput={text("new_user_turns")} /></Field>
        </div>
        <Check checked={form.store_questions === "1"} onChange={(v) => set("store_questions", v ? "1" : "0")} label="Guardar el texto de las preguntas en las estadísticas"
          hint="Apagado: solo se guarda el texto de las preguntas que Buddy no pudo responder, sin el nombre de quien preguntó." />
        <div>
          <ConfirmButton label="Borrar todas las conversaciones" title="Borrar todas las conversaciones" message="Se borra el historial de chat de todas las personas. Las estadísticas y los cupos no cambian. No se puede deshacer." confirmLabel="Borrar todo"
            onConfirm={async () => { try { const r = await del("/api/admin/conversations"); toast(`${r.deleted} mensajes borrados.`); } catch (err) { fail(err); } }} />
        </div>
      </section>
    </form>
  );
}
