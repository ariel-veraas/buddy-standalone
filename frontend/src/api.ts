let csrf = "";
export const setCsrf = (value: string) => { csrf = value; };

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
export const onUnauthorized = (fn: Listener) => { unauthorizedListeners.add(fn); return () => unauthorizedListeners.delete(fn); };

async function parseError(res: Response): Promise<ApiError> {
  let data: any = null;
  try { data = await res.json(); } catch { /* sin cuerpo JSON */ }
  const detail = typeof data?.detail === "string" ? data.detail
    : Array.isArray(data?.detail) ? "Revisá los datos: hay campos con valores inválidos." : undefined;
  return new ApiError(res.status, detail ?? `Algo salió mal (${res.status}).`, data?.error);
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  if (method !== "GET") headers["X-CSRF-Token"] = csrf;
  let res: Response;
  try { res = await fetch(path, { method, headers, body: payload, credentials: "same-origin" }); }
  catch { throw new ApiError(0, "No pude conectarme con el servidor. Revisá tu conexión."); }
  if (res.status === 401 && !path.startsWith("/api/auth/login")) unauthorizedListeners.forEach((fn) => fn());
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<T>;
}

export const get = <T = any>(path: string) => api<T>("GET", path);
export const post = <T = any>(path: string, body?: unknown) => api<T>("POST", path, body ?? {});
export const put = <T = any>(path: string, body?: unknown) => api<T>("PUT", path, body ?? {});
export const patch = <T = any>(path: string, body?: unknown) => api<T>("PATCH", path, body ?? {});
export const del = <T = any>(path: string) => api<T>("DELETE", path);

export type StreamEvent = { event: "delta"; data: { text: string } } | { event: "done"; data: any } | { event: "error"; data: { error: string } };

/** Pregunta con streaming (SSE sobre fetch). Lanza ApiError con `code` si el servidor rechaza antes de empezar. */
export async function streamChat(body: object, onEvent: (e: StreamEvent) => void, signal?: AbortSignal) {
  let res: Response;
  try {
    res = await fetch("/api/chat/stream", {
      method: "POST", credentials: "same-origin", signal,
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify(body),
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    throw new ApiError(0, "No pude conectarme con el servidor. Revisá tu conexión.", "network");
  }
  if (res.status === 401) unauthorizedListeners.forEach((fn) => fn());
  if (!res.ok || !res.body) throw await parseError(res);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      let event = "message", data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      if (data) onEvent({ event, data: JSON.parse(data) } as StreamEvent);
    }
  }
}

export const CHAT_ERRORS: Record<string, string> = {
  rate_limited: "Estás preguntando muy rápido. Esperá un minuto y probá de nuevo.",
  daily_limit: "Llegaste al límite de consultas de hoy. Mañana podés seguir.",
  system_limit: "Se alcanzó el límite diario de consultas de la empresa. Probá mañana.",
  busy: "Buddy está atendiendo a otras personas. Probá de nuevo en unos segundos.",
  request_pending: "Esa consulta ya se está procesando.",
  not_configured: "Buddy todavía no está configurado. Avisale a un administrador.",
  provider_auth: "El proveedor de IA rechazó la API key. Avisale a un administrador.",
  provider_error: "No pude consultar al proveedor de IA. Probá de nuevo en un rato.",
  provider_timeout: "La respuesta tardó demasiado. Probá de nuevo.",
  invalid_response: "No pude armar una respuesta válida. Probá reformular la pregunta.",
  invalid_message: "El mensaje está vacío o es demasiado largo (máximo 2000 caracteres).",
  session_changed: "La conversación cambió. Volvé a preguntar.",
  network: "No pude conectarme con el servidor. Revisá tu conexión.",
  client_disconnected: "Se cortó la conexión.",
};
