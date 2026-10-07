import { get } from "../api";
import { Icon, Loading, useLoad, when } from "../ui";

type Event = { at: string; actor: string; action: string; detail: string; ip: string };

const ACTIONS: Record<string, string> = {
  setup: "Primer arranque", login: "Inició sesión", login_failed: "Intento de acceso fallido", logout: "Cerró sesión",
  password_changed: "Cambió su contraseña", password_reset: "Generó una clave temporal", user_created: "Agregó una persona",
  user_updated: "Editó una persona", user_deleted: "Borró una persona", group_created: "Creó un grupo", group_deleted: "Borró un grupo",
  collection_created: "Creó una colección", collection_updated: "Editó una colección", collection_deleted: "Borró una colección",
  document_deleted: "Quitó un documento", documents_uploaded: "Subió documentos", settings_changed: "Cambió ajustes",
  secret_removed: "Quitó una clave guardada", conversations_deleted: "Borró todas las conversaciones",
};

export function Audit() {
  const list = useLoad(() => get<Event[]>("/api/admin/audit?limit=200"));
  return (
    <div class="page">
      <div class="page-head">
        <div><h1>Registro de actividad</h1><p>Quién cambió qué, y los accesos. Se guardan los últimos movimientos de administración.</p></div>
        <button class="btn" onClick={list.reload}><Icon name="refresh" />Actualizar</button>
      </div>
      <Loading error={list.error} loading={list.loading && !list.data} retry={list.reload} />
      {list.data && list.data.length === 0 && <div class="empty"><h3>Todavía no hay actividad registrada</h3></div>}
      {!!list.data?.length && (
        <div class="list">
          {list.data.map((e, i) => (
            <div class="item" key={i}>
              <div>
                <div class="title">{ACTIONS[e.action] ?? e.action}</div>
                <div class="meta"><span>{e.actor || "—"}</span>{e.detail && <span>{e.detail}</span>}{e.ip && <span>IP {e.ip}</span>}</div>
              </div>
              <span class="faint">{when(e.at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
