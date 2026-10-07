import { useEffect, useRef, useState } from "preact/hooks";
import { del, get, patch, post } from "../api";
import { isStaff, useSession } from "../session";
import { Check, ConfirmButton, Field, Icon, Loading, Modal, fail, num, toast, useLoad, when } from "../ui";

type Group = { id: number; name: string };
type Collection = {
  id: number; name: string; kind: "upload" | "drive"; drive_folder: string | null; active: boolean; visibility: "all" | "groups";
  state: string; error: string | null; last_sync: string | null; documents: number; documents_with_errors: number; chunks: number; groups: Group[];
};
type Doc = { id: number; name: string; path: string; state: string; error: string | null; chunks: number; modified: string; link: string };

const STATE: Record<string, [string, string]> = { idle: ["Al día", "ok"], syncing: ["Sincronizando…", "info"], error: ["Con error", "bad"] };

export function Collections() {
  const { user } = useSession();
  const list = useLoad(() => get<Collection[]>("/api/collections"));
  const groups = useLoad(() => get<Group[]>("/api/admin/groups"));
  const [editing, setEditing] = useState<Collection | "new" | null>(null);
  const [opened, setOpened] = useState<Collection | null>(null);

  // Mientras alguna colección sincroniza, se refresca sola cada pocos segundos.
  const syncing = list.data?.some((c) => c.state === "syncing");
  useInterval(() => list.reload(), syncing ? 4000 : null);

  if (!isStaff(user)) return null;
  if (opened) return <Documents collection={opened} onBack={() => { setOpened(null); list.reload(); }} />;

  return (
    <div class="page">
      <div class="page-head">
        <div><h1>Documentos</h1><p>Cada colección es un conjunto de documentos que Buddy puede leer. Elegís quién puede consultar cada una.</p></div>
        <button class="btn primary" onClick={() => setEditing("new")}><Icon name="plus" />Agregar colección</button>
      </div>
      <Loading error={list.error} loading={list.loading && !list.data} retry={list.reload} />
      {list.data && list.data.length === 0 && (
        <div class="empty">
          <h3>Todavía no hay documentos</h3>
          <p>Creá una colección, subí tus PDF, Word o textos (o conectá una carpeta de Google Drive) y Buddy empieza a responder con ellos.</p>
          <button class="btn primary" onClick={() => setEditing("new")}>Crear la primera colección</button>
        </div>
      )}
      {!!list.data?.length && (
        <div class="list">
          {list.data.map((c) => {
            const [label, tone] = STATE[c.state] ?? [c.state, ""];
            return (
              <div class="item" key={c.id}>
                <div>
                  <div class="row"><span class="title">{c.name}</span><span class={`pill ${tone}`}>{label}</span>{!c.active && <span class="pill">Pausada</span>}<span class="pill">{c.kind === "drive" ? "Google Drive" : "Subida manual"}</span></div>
                  <div class="meta">
                    <span>{num(c.documents)} documentos · {num(c.chunks)} fragmentos</span>
                    {c.documents_with_errors > 0 && <span style="color:var(--danger)">{c.documents_with_errors} con error</span>}
                    <span>{c.visibility === "all" ? "La puede consultar cualquier persona" : c.groups.length ? `Grupos: ${c.groups.map((g) => g.name).join(", ")}` : "Solo administradores y editores (sin grupos)"}</span>
                    {c.kind === "drive" && <span>Última sincronización: {when(c.last_sync)}</span>}
                  </div>
                  {c.error && <div class="meta" style="color:var(--danger)">{c.error}</div>}
                </div>
                <div class="actions">
                  <button class="btn small" onClick={() => setOpened(c)}>Ver documentos</button>
                  {c.kind === "drive" && user?.role === "admin" && <button class="btn small" disabled={c.state === "syncing"} onClick={async () => { try { await post(`/api/collections/${c.id}/sync`); toast("Sincronización iniciada."); list.reload(); } catch (e) { fail(e); } }}><Icon name="refresh" />Sincronizar</button>}
                  <button class="btn small" onClick={() => setEditing(c)}>Editar</button>
                  <ConfirmButton label="Borrar" title={`Borrar «${c.name}»`} message="Se borran la colección, todos sus documentos y sus fragmentos. Buddy deja de poder responder con ellos. No se puede deshacer." confirmLabel="Borrar colección"
                    onConfirm={async () => { try { await del(`/api/collections/${c.id}`); toast("Colección borrada."); list.reload(); } catch (e) { fail(e); } }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
      {editing && <EditCollection value={editing === "new" ? null : editing} groups={groups.data ?? []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />}
    </div>
  );
}

function useInterval(fn: () => void, ms: number | null) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (!ms) return;
    const id = window.setInterval(() => saved.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}

function EditCollection({ value, groups, onClose, onSaved }: { value: Collection | null; groups: Group[]; onClose: () => void; onSaved: () => void }) {
  const admin = useSession().user?.role === "admin";
  const [name, setName] = useState(value?.name ?? "");
  const [kind, setKind] = useState<"upload" | "drive">(value?.kind ?? "upload");
  const [folder, setFolder] = useState(value?.drive_folder ?? "");
  const [visibility, setVisibility] = useState<"all" | "groups">(value?.visibility ?? "groups");
  const [ids, setIds] = useState<number[]>(value?.groups.map((g) => g.id) ?? []);
  const [active, setActive] = useState(value?.active ?? true);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      // Un editor solo pone el nombre: qué se publica y a quién (Drive, visibilidad, grupos) lo decide un administrador.
      const body: any = admin ? { name, visibility, group_ids: ids, active } : { name };
      if (!value) { if (admin) { body.kind = kind; body.drive_folder = kind === "drive" ? folder : null; } await post("/api/collections", body); }
      else { if (admin && value.kind === "drive") body.drive_folder = folder; await patch(`/api/collections/${value.id}`, body); }
      toast(value ? "Cambios guardados." : "Colección creada.");
      onSaved();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={value ? "Editar colección" : "Agregar colección"} onClose={onClose} actions={<><button class="btn" onClick={onClose}>Cancelar</button><button class="btn primary" disabled={busy || !name.trim()} onClick={save}>{value ? "Guardar cambios" : "Crear colección"}</button></>}>
      <Field label="Nombre" id="c-name"><input id="c-name" class="input" maxLength={120} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></Field>
      {!admin && <div class="note">Una persona con rol de administrador define quién puede consultar esta colección. Hasta entonces solo la ven administradores y editores.</div>}
      {admin && !value && (
        <Field label="Origen" id="c-kind">
          <select id="c-kind" class="input" value={kind} onChange={(e) => setKind((e.target as HTMLSelectElement).value as any)}>
            <option value="upload">Subir archivos (PDF, Word, texto, HTML)</option>
            <option value="drive">Carpeta de Google Drive</option>
          </select>
        </Field>
      )}
      {admin && (kind === "drive" || value?.kind === "drive") && (
        <Field label="Carpeta de Drive" id="c-folder" hint="Pegá el link de la carpeta. Compartila (solo lectura) con el email de la cuenta de servicio que cargaste en Ajustes."><input id="c-folder" class="input" value={folder} onInput={(e) => setFolder((e.target as HTMLInputElement).value)} /></Field>
      )}
      {admin && <Field label="¿Quién puede consultarla?" id="c-vis">
        <select id="c-vis" class="input" value={visibility} onChange={(e) => setVisibility((e.target as HTMLSelectElement).value as any)}>
          <option value="groups">Solo los grupos que elija</option>
          <option value="all">Cualquier persona con cuenta</option>
        </select>
      </Field>}
      {admin && visibility === "groups" && (
        groups.length ? <div class="stack" role="group" aria-label="Grupos con acceso">{groups.map((g) => <Check key={g.id} label={g.name} checked={ids.includes(g.id)} onChange={(on) => setIds(on ? [...ids, g.id] : ids.filter((x) => x !== g.id))} />)}</div>
          : <div class="note warn">Todavía no hay grupos. Creá uno en “Personas” para darle acceso. Mientras tanto solo la ven administradores y editores.</div>
      )}
      {admin && value && <Check label="Activa" hint="Si la pausás, Buddy deja de usar sus documentos pero no se borran." checked={active} onChange={setActive} />}
    </Modal>
  );
}

function Documents({ collection, onBack }: { collection: Collection; onBack: () => void }) {
  const docs = useLoad(() => get<Doc[]>(`/api/collections/${collection.id}/documents`), [collection.id]);
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [report, setReport] = useState<{ name: string; result: string; error: string | null }[] | null>(null);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const form = new FormData();
      Array.from(files).forEach((f) => form.append("files", f));
      const res = await post(`/api/collections/${collection.id}/upload`, form);
      setReport(res.results);
      docs.reload();
    } catch (e) { fail(e); } finally { setUploading(false); if (input.current) input.current.value = ""; }
  };

  return (
    <div class="page">
      <div class="page-head">
        <div><button class="btn quiet small" onClick={onBack}>← Volver a las colecciones</button><h1 style="margin-top:.4rem">{collection.name}</h1></div>
        {collection.kind === "upload" && (
          <div>
            <input ref={input} type="file" multiple hidden accept=".pdf,.docx,.txt,.md,.csv,.html,.htm" onChange={(e) => upload((e.target as HTMLInputElement).files)} />
            <button class="btn primary" disabled={uploading} onClick={() => input.current?.click()}><Icon name="upload" />{uploading ? "Subiendo…" : "Subir archivos"}</button>
          </div>
        )}
      </div>
      {report && (
        <div class={`note ${report.some((r) => r.result === "error") ? "warn" : "good"}`} role="status">
          <div class="stack" style="gap:.25rem">
            {report.map((r, i) => <span key={i}><b>{r.name}</b>: {r.result === "updated" ? "listo" : r.result === "unchanged" ? "sin cambios" : r.result === "skipped" ? "sin texto para indexar" : `no se pudo leer (${r.error})`}</span>)}
          </div>
        </div>
      )}
      <Loading error={docs.error} loading={docs.loading && !docs.data} retry={docs.reload} />
      {docs.data && docs.data.length === 0 && <div class="empty"><h3>Esta colección está vacía</h3><p>{collection.kind === "upload" ? "Subí PDF, Word (.docx), HTML, .txt, .md o .csv. También podés arrastrar varios a la vez." : "Sincronizá la colección para traer los documentos de la carpeta de Drive."}</p></div>}
      {!!docs.data?.length && (
        <div class="list">
          {docs.data.map((d) => (
            <div class="item" key={d.id}>
              <div>
                <div class="row"><span class="title">{d.name}</span>{d.state === "error" && <span class="pill bad">Con error</span>}{d.state === "skipped" && <span class="pill warn">Sin texto</span>}</div>
                <div class="meta">{d.path && <span>{d.path}</span>}<span>{num(d.chunks)} fragmentos</span>{d.modified && <span>Modificado: {d.modified.slice(0, 10)}</span>}</div>
                {d.error && <div class="meta" style="color:var(--doubt)">{d.error}</div>}
              </div>
              <div class="actions">
                {d.link && <a class="btn small" href={d.link} target="_blank" rel="noopener noreferrer">Abrir</a>}
                <ConfirmButton label="Quitar" title={`Quitar «${d.name}»`} message="Buddy deja de poder responder con este documento." confirmLabel="Quitar documento"
                  onConfirm={async () => { try { await del(`/api/collections/${collection.id}/documents/${d.id}`); docs.reload(); } catch (e) { fail(e); } }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
