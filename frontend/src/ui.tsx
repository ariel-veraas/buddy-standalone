import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { ApiError } from "./api";

/* ---------- Íconos (trazo simple, heredan el color) ---------- */
const P: Record<string, string> = {
  chat: "M4 5h16v11H9l-5 4zM8 9h8M8 12h5",
  books: "M5 4h4v16H5zM11 4h4v16h-4zM17.5 5.5l3 .8-3.8 13.7-3-.8",
  users: "M9 11a3 3 0 100-6 3 3 0 000 6zM3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 6.5a3 3 0 010 5.5M18 15c2 .5 3 2 3 4",
  gear: "M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1.2-1.6-2.8-2.2.7a7 7 0 00-1.8-1L15 5h-3.2l-.4 2.7a7 7 0 00-1.8 1l-2.2-.7L5.8 10.8 7.8 12a7 7 0 000 2l-2 1.2 1.6 2.8 2.2-.7a7 7 0 001.8 1l.4 2.7H15l.4-2.7a7 7 0 001.8-1l2.2.7 1.6-2.8L19 14a7 7 0 000-2z",
  chart: "M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-7",
  mail: "M4 6h16v12H4zM4 7l8 6 8-6",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  up: "M7 11v8H4v-8zM7 11l4-7c1.5 0 2.5 1 2 3l-.5 2H19a1.5 1.5 0 011.5 1.8l-1.3 6A2 2 0 0117.2 19H7",
  down: "M7 13V5H4v8zM7 13l4 7c1.5 0 2.5-1 2-3l-.5-2H19a1.5 1.5 0 001.5-1.8l-1.3-6A2 2 0 0017.2 5H7",
  plus: "M12 5v14M5 12h14",
  upload: "M12 16V5M7 9l5-5 5 5M5 19h14",
  refresh: "M20 6v5h-5M4 18v-5h5M6.3 9A7 7 0 0118 7.5L20 11M17.7 15A7 7 0 016 16.5L4 13",
  send: "M4 12l16-8-6 16-3-6.5z",
  new: "M12 5v14M5 12h14",
  out: "M10 5H5v14h5M15 8l4 4-4 4M19 12H9",
  check: "M5 12.5l4.5 4.5L19 7.5M4 4h16v16H4z",
  spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z",
};
export function Icon({ name }: { name: keyof typeof P | string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={P[name] ?? ""} /></svg>;
}

/* ---------- Avisos flotantes ---------- */
type Toast = { id: number; text: string; bad: boolean };
let toasts: Toast[] = [];
const toastListeners = new Set<() => void>();
export function toast(text: string, bad = false) {
  const t = { id: Date.now() + Math.random(), text, bad };
  toasts = [...toasts, t];
  toastListeners.forEach((fn) => fn());
  setTimeout(() => { toasts = toasts.filter((x) => x.id !== t.id); toastListeners.forEach((fn) => fn()); }, bad ? 7000 : 3800);
}
export const fail = (e: unknown) => toast(e instanceof ApiError ? e.message : "Algo salió mal. Probá de nuevo.", true);
export function Toasts() {
  const [, force] = useState(0);
  useEffect(() => { const fn = () => force((n) => n + 1); toastListeners.add(fn); return () => { toastListeners.delete(fn); }; }, []);
  return <div class="toasts" role="status" aria-live="polite">{toasts.map((t) => <div key={t.id} class={`toast ${t.bad ? "bad" : ""}`}>{t.text}</div>)}</div>;
}

/* ---------- Diálogos ---------- */
export function Modal({ title, onClose, children, actions }: { title: string; onClose: () => void; children: ComponentChildren; actions?: ComponentChildren }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} onClose={onClose} onCancel={onClose} aria-labelledby="modal-title">
      <h2 id="modal-title">{title}</h2>
      <div class="stack">{children}</div>
      {actions && <div class="actions">{actions}</div>}
    </dialog>
  );
}

export function ConfirmButton({ label, title, message, confirmLabel, onConfirm, class: cls = "btn danger small" }:
  { label: ComponentChildren; title: string; message: string; confirmLabel: string; onConfirm: () => void | Promise<void>; class?: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button type="button" class={cls} onClick={() => setOpen(true)}>{label}</button>
      {open && (
        <Modal title={title} onClose={() => setOpen(false)} actions={<>
          <button class="btn" onClick={() => setOpen(false)}>Cancelar</button>
          <button class="btn danger" disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(); setOpen(false); } finally { setBusy(false); } }}>{confirmLabel}</button>
        </>}>
          <p>{message}</p>
        </Modal>
      )}
    </>
  );
}

/* ---------- Formularios ---------- */
export function Field({ label, hint, children, id }: { label: string; hint?: ComponentChildren; children: ComponentChildren; id?: string }) {
  return <div class="field"><label for={id}>{label}</label>{children}{hint && <span class="hint">{hint}</span>}</div>;
}

export function Check({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label class="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
      <span>{label}{hint && <span class="hint" style="display:block">{hint}</span>}</span>
    </label>
  );
}

/* ---------- Carga de datos ---------- */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    try { setData(await loader()); setError(null); }
    catch (e) { setError(e instanceof ApiError ? e.message : "No pude cargar los datos."); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}

export function Loading({ error, loading, retry }: { error: string | null; loading: boolean; retry?: () => void }) {
  if (error) return <div class="note bad" role="alert"><span>{error}</span>{retry && <button class="btn small" onClick={retry}>Reintentar</button>}</div>;
  return loading ? <p class="faint" aria-live="polite">Cargando…</p> : null;
}

/* ---------- Formato ---------- */
export function when(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(+d)) return "—";
  return d.toLocaleString("es-AR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
export const num = (n: number) => n.toLocaleString("es-AR");
