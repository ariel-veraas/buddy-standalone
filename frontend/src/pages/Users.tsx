import { useState } from "preact/hooks";
import { del, get, patch, post } from "../api";
import { Check, ConfirmButton, Field, Loading, Modal, fail, toast, useLoad, when } from "../ui";

type Group = { id: number; name: string; members: number };
type Person = { id: number; email: string; name: string; role: "admin" | "editor" | "user"; active: boolean; must_change_password: boolean; last_login: string | null; groups: { id: number; name: string }[] };

const ROLE: Record<string, string> = { admin: "Administrador", editor: "Editor", user: "Usuario" };
const ROLE_HINT: Record<string, string> = {
  admin: "Todo: personas, ajustes y documentos.",
  editor: "Carga y organiza documentos; ve las estadísticas. No cambia ajustes ni personas.",
  user: "Solo pregunta a Buddy, con los documentos de sus grupos.",
};

export function Users() {
  const [tab, setTab] = useState<"people" | "groups">("people");
  const people = useLoad(() => get<Person[]>("/api/admin/users"));
  const groups = useLoad(() => get<Group[]>("/api/admin/groups"));
  return (
    <div class="page">
      <div class="page-head"><div><h1>Personas</h1><p>Quién puede entrar a Buddy y qué documentos puede consultar.</p></div></div>
      <div class="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "people"} onClick={() => setTab("people")}>Personas</button>
        <button role="tab" aria-selected={tab === "groups"} onClick={() => setTab("groups")}>Grupos</button>
      </div>
      {tab === "people"
        ? <People people={people} groups={groups.data ?? []} onChanged={() => { people.reload(); groups.reload(); }} />
        : <Groups groups={groups} onChanged={() => { groups.reload(); people.reload(); }} />}
    </div>
  );
}

function People({ people, groups, onChanged }: { people: ReturnType<typeof useLoad<Person[]>>; groups: Group[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<Person | "new" | null>(null);
  const [secret, setSecret] = useState<{ who: string; password: string } | null>(null);
  return (
    <>
      <div class="row"><span class="grow" /><button class="btn primary" onClick={() => setEditing("new")}>Agregar persona</button></div>
      <Loading error={people.error} loading={people.loading && !people.data} retry={people.reload} />
      {!!people.data?.length && (
        <div class="list">
          {people.data.map((p) => (
            <div class="item" key={p.id}>
              <div>
                <div class="row"><span class="title">{p.name}</span><span class="pill info">{ROLE[p.role]}</span>{!p.active && <span class="pill bad">Desactivada</span>}{p.must_change_password && p.active && <span class="pill warn">Clave temporal</span>}</div>
                <div class="meta"><span>{p.email}</span><span>{p.groups.length ? p.groups.map((g) => g.name).join(", ") : "Sin grupos"}</span><span>Último acceso: {when(p.last_login)}</span></div>
              </div>
              <div class="actions">
                <button class="btn small" onClick={() => setEditing(p)}>Editar</button>
                <ConfirmButton class="btn small" label="Nueva clave temporal" title={`Nueva clave para ${p.name}`} message="Se cierra su sesión y tendrá que elegir otra contraseña al entrar. La clave temporal se muestra una sola vez." confirmLabel="Generar clave"
                  onConfirm={async () => { try { const r = await post(`/api/admin/users/${p.id}/reset-password`); setSecret({ who: p.name, password: r.temporary_password }); } catch (e) { fail(e); } }} />
                <ConfirmButton label="Borrar" title={`Borrar a ${p.name}`} message="Se borra la cuenta y su historial de conversaciones. No se puede deshacer; si solo querés que no entre más, desactivala." confirmLabel="Borrar cuenta"
                  onConfirm={async () => { try { await del(`/api/admin/users/${p.id}`); toast("Cuenta borrada."); onChanged(); } catch (e) { fail(e); } }} />
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && <EditPerson value={editing === "new" ? null : editing} groups={groups} onClose={() => setEditing(null)}
        onSaved={(temporary, who) => { setEditing(null); onChanged(); if (temporary) setSecret({ who, password: temporary }); else toast("Cambios guardados."); }} />}
      {secret && (
        <Modal title="Contraseña temporal" onClose={() => setSecret(null)} actions={<button class="btn primary" onClick={() => setSecret(null)}>Listo, ya la copié</button>}>
          <p>Pasale esta clave a {secret.who}. Al entrar va a tener que elegir una propia.</p>
          <div class="secret">{secret.password}</div>
          <div class="note warn">Se muestra una sola vez. Si la perdés, generá otra.</div>
        </Modal>
      )}
    </>
  );
}

function EditPerson({ value, groups, onClose, onSaved }: { value: Person | null; groups: Group[]; onClose: () => void; onSaved: (temporary: string | null, who: string) => void }) {
  const [name, setName] = useState(value?.name ?? "");
  const [email, setEmail] = useState(value?.email ?? "");
  const [role, setRole] = useState(value?.role ?? "user");
  const [active, setActive] = useState(value?.active ?? true);
  const [ids, setIds] = useState<number[]>(value?.groups.map((g) => g.id) ?? []);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      if (value) { await patch(`/api/admin/users/${value.id}`, { name, role, active, group_ids: ids }); onSaved(null, name); }
      else { const r = await post("/api/admin/users", { name, email, role, group_ids: ids, password: password || null }); onSaved(r.temporary_password, name); }
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={value ? "Editar persona" : "Agregar persona"} onClose={onClose} actions={<><button class="btn" onClick={onClose}>Cancelar</button><button class="btn primary" disabled={busy || !name.trim() || !email.trim()} onClick={save}>{value ? "Guardar cambios" : "Agregar persona"}</button></>}>
      <Field label="Nombre" id="u-name"><input id="u-name" class="input" maxLength={120} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></Field>
      <Field label="Email" id="u-email"><input id="u-email" class="input" type="email" disabled={!!value} value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} /></Field>
      <Field label="Rol" id="u-role" hint={ROLE_HINT[role]}>
        <select id="u-role" class="input" value={role} onChange={(e) => setRole((e.target as HTMLSelectElement).value as Person["role"])}>
          {Object.entries(ROLE).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </Field>
      {role === "user" && (groups.length
        ? <div class="field"><span class="label">Grupos</span><div class="stack" role="group" aria-label="Grupos">{groups.map((g) => <Check key={g.id} label={g.name} checked={ids.includes(g.id)} onChange={(on) => setIds(on ? [...ids, g.id] : ids.filter((x) => x !== g.id))} />)}</div></div>
        : <div class="note warn">Todavía no hay grupos. Creá uno en la pestaña “Grupos” para darle acceso a documentos restringidos.</div>)}
      {role !== "user" && <p class="faint">Administradores y editores ven todas las colecciones.</p>}
      {!value && <Field label="Contraseña" id="u-pw" hint="Si la dejás vacía, se genera una temporal."><input id="u-pw" class="input" type="password" autocomplete="new-password" minLength={10} value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} /></Field>}
      {value && <Check label="Cuenta activa" hint="Si la desactivás, no puede entrar pero se conserva." checked={active} onChange={setActive} />}
    </Modal>
  );
}

function Groups({ groups, onChanged }: { groups: ReturnType<typeof useLoad<Group[]>>; onChanged: () => void }) {
  const [name, setName] = useState("");
  const create = async (e: Event) => {
    e.preventDefault();
    try { await post("/api/admin/groups", { name }); setName(""); toast("Grupo creado."); onChanged(); } catch (err) { fail(err); }
  };
  return (
    <>
      <form class="row" onSubmit={create}>
        <label class="sr-only" for="g-name">Nombre del grupo</label>
        <input id="g-name" class="input grow" style="max-width:20rem" maxLength={80} placeholder="Por ejemplo: Recursos Humanos" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        <button class="btn primary" disabled={!name.trim()}>Crear grupo</button>
      </form>
      <Loading error={groups.error} loading={groups.loading && !groups.data} retry={groups.reload} />
      {groups.data && groups.data.length === 0 && <div class="empty"><h3>Todavía no hay grupos</h3><p>Los grupos deciden quién puede leer cada colección de documentos.</p></div>}
      {!!groups.data?.length && (
        <div class="list">
          {groups.data.map((g) => (
            <div class="item" key={g.id}>
              <div><span class="title">{g.name}</span><div class="meta"><span>{g.members} {g.members === 1 ? "persona" : "personas"}</span></div></div>
              <div class="actions"><ConfirmButton label="Borrar" title={`Borrar el grupo «${g.name}»`} message="Las personas pierden el acceso a las colecciones que solo se abrían por este grupo." confirmLabel="Borrar grupo"
                onConfirm={async () => { try { await del(`/api/admin/groups/${g.id}`); toast("Grupo borrado."); onChanged(); } catch (e) { fail(e); } }} /></div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
