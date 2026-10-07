import { useState } from "preact/hooks";
import { del, get, patch, put } from "../api";
import { ConfirmButton, Field, Loading, Modal, fail, toast, useLoad, when } from "../ui";
import { useSession } from "../session";

type Ticket = { id: number; name: string; description: string; state: string; created_at: string; requester: string; email: string; staff_notes?: string };
type Contact = { id: number; code: string; label: string; name: string; email: string; note: string };
const STATES: Record<string, string> = { new: "Nuevo", progress: "En curso", done: "Resuelto" };

export function Support() {
  const [tab, setTab] = useState<"tickets" | "contacts">("tickets");
  return (
    <div class="page">
      <div class="page-head"><div><h1>Contactos y tickets</h1><p>Cuando Buddy no sabe algo, le muestra a la persona a quién preguntarle y le deja pedir un ticket.</p></div></div>
      <div class="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "tickets"} onClick={() => setTab("tickets")}>Tickets</button>
        <button role="tab" aria-selected={tab === "contacts"} onClick={() => setTab("contacts")}>Contactos</button>
      </div>
      {tab === "tickets" ? <Tickets /> : <Contacts />}
    </div>
  );
}

function Tickets() {
  const list = useLoad(() => get<Ticket[]>("/api/admin/tickets"));
  const setState = async (t: Ticket, state: string) => {
    try { await patch(`/api/admin/tickets/${t.id}`, { state }); list.reload(); } catch (e) { fail(e); }
  };
  return (
    <>
      <Loading error={list.error} loading={list.loading && !list.data} retry={list.reload} />
      {list.data && list.data.length === 0 && <div class="empty"><h3>Todavía nadie pidió ayuda a una persona</h3><p>Los tickets aparecen cuando alguien le pide a Buddy que escale una consulta que no pudo resolver.</p></div>}
      {!!list.data?.length && (
        <div class="list">
          {list.data.map((t) => (
            <div class="item" key={t.id}>
              <div>
                <div class="row"><span class="title">{t.name}</span><span class={`pill ${t.state === "done" ? "ok" : t.state === "progress" ? "info" : "warn"}`}>{STATES[t.state] ?? t.state}</span></div>
                <div class="meta"><span>{t.requester} ({t.email})</span><span>{when(t.created_at)}</span></div>
                {t.description && <p class="muted" style="margin-top:.35rem;white-space:pre-wrap">{t.description}</p>}
                <TicketNotes ticket={t} onSaved={list.reload}/>
              </div>
              <div class="actions">
                <label class="sr-only" for={`t-${t.id}`}>Estado del ticket</label>
                <select id={`t-${t.id}`} class="input" style="width:auto" value={t.state} onChange={(e) => setState(t, (e.target as HTMLSelectElement).value)}>
                  {Object.entries(STATES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function TicketNotes({ ticket, onSaved }: { ticket: Ticket; onSaved: () => void }) {
  const [notes, setNotes] = useState(ticket.staff_notes ?? ""), [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await patch(`/api/admin/tickets/${ticket.id}`, { staff_notes: notes, state: "done" }); toast("Respuesta guardada y ticket resuelto."); onSaved(); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };
  return <div class="gba-ticket-notes"><Field label="Respuesta o notas de tu equipo" id={`ticket-notes-${ticket.id}`} hint="Buddy solo propone borradores a partir de este material humano y la pregunta del ticket."><textarea id={`ticket-notes-${ticket.id}`} class="input" rows={3} maxLength={6000} value={notes} onInput={(e) => setNotes(e.currentTarget.value)}/></Field><button class="btn small" disabled={busy || !notes.trim()} onClick={save}>{busy ? "Guardando…" : "Guardar respuesta y resolver"}</button></div>;
}

function Contacts() {
  const { user } = useSession();
  const admin = user?.role === "admin";
  const list = useLoad(() => get<Contact[]>("/api/admin/contacts"));
  const [editing, setEditing] = useState<Contact | "new" | null>(null);
  return (
    <>
      {admin && <div class="row"><span class="grow" /><button class="btn primary" onClick={() => setEditing("new")}>Agregar contacto</button></div>}
      <Loading error={list.error} loading={list.loading && !list.data} retry={list.reload} />
      {list.data && list.data.length === 0 && (
        <div class="empty"><h3>Todavía no hay contactos</h3><p>Agregá un contacto con el código <b>general</b>: es el que Buddy muestra cuando no sabe a quién derivar. Después podés sumar otros, como <b>rrhh</b> o <b>sistemas</b>.</p></div>
      )}
      {!!list.data?.length && (
        <div class="list">
          {list.data.map((c) => (
            <div class="item" key={c.id}>
              <div>
                <div class="row"><span class="title">{c.name}</span><span class="pill">{c.code}</span></div>
                <div class="meta">{c.label && <span>{c.label}</span>}{c.email && <span>{c.email}</span>}{c.note && <span>{c.note}</span>}</div>
              </div>
              {admin && (
                <div class="actions">
                  <button class="btn small" onClick={() => setEditing(c)}>Editar</button>
                  <ConfirmButton label="Borrar" title={`Borrar a ${c.name}`} message="Buddy deja de derivar consultas a este contacto." confirmLabel="Borrar contacto"
                    onConfirm={async () => { try { await del(`/api/admin/contacts/${c.id}`); toast("Contacto borrado."); list.reload(); } catch (e) { fail(e); } }} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {editing && <EditContact value={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); toast("Contacto guardado."); }} />}
    </>
  );
}

function EditContact({ value, onClose, onSaved }: { value: Contact | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ code: value?.code ?? "", label: value?.label ?? "", name: value?.name ?? "", email: value?.email ?? "", note: value?.note ?? "" });
  const [busy, setBusy] = useState(false);
  const on = (key: keyof typeof f) => (e: Event) => setF({ ...f, [key]: (e.target as HTMLInputElement).value });
  const save = async () => {
    setBusy(true);
    try { await put("/api/admin/contacts", f); onSaved(); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={value ? "Editar contacto" : "Agregar contacto"} onClose={onClose} actions={<><button class="btn" onClick={onClose}>Cancelar</button><button class="btn primary" disabled={busy || !f.code || !f.name.trim()} onClick={save}>Guardar contacto</button></>}>
      <Field label="Código" id="k-code" hint="Rol interno en minúsculas, sin espacios: general, rrhh, sistemas…"><input id="k-code" class="input" pattern="[a-z0-9_\-]+" maxLength={40} disabled={!!value} value={f.code} onInput={on("code")} /></Field>
      <Field label="Nombre" id="k-name"><input id="k-name" class="input" maxLength={120} value={f.name} onInput={on("name")} /></Field>
      <Field label="Área o cargo" id="k-label"><input id="k-label" class="input" maxLength={80} value={f.label} onInput={on("label")} /></Field>
      <Field label="Email" id="k-email"><input id="k-email" class="input" type="email" value={f.email} onInput={on("email")} /></Field>
      <Field label="Nota" id="k-note"><input id="k-note" class="input" maxLength={200} value={f.note} onInput={on("note")} /></Field>
    </Modal>
  );
}
