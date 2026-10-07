import { useEffect, useState } from "preact/hooks";
import { get, post, setCsrf, onUnauthorized } from "./api";
import type { Species } from "./buddy/personality";

export type User = { id: number; email: string; name: string; role: "admin" | "editor" | "user"; must_change_password: boolean };
export type Brand = { name: string; species: Species; color: string };
type State = { status: "loading" | "setup" | "anon" | "ready"; user: User | null; needsToken?: boolean; brand: Brand };

let state: State = { status: "loading", user: null, brand: { name: "Buddy", species: "mochi", color: "" } };
const listeners = new Set<() => void>();
const set = (next: Omit<State, "brand"> & { brand?: Brand }) => { state = { ...next, brand: next.brand ?? state.brand }; listeners.forEach((fn) => fn()); };

export function useSession(): State {
  const [, force] = useState(0);
  useEffect(() => { const fn = () => force((n) => n + 1); listeners.add(fn); return () => { listeners.delete(fn); }; }, []);
  return state;
}

export async function boot() {
  try {
    const { needs_setup, needs_token, brand } = await get("/api/setup/status");
    if (brand) state = { ...state, brand };
    if (needs_setup) return set({ status: "setup", user: null, needsToken: !!needs_token });
    const me = await get("/api/auth/me");
    setCsrf(me.csrf);
    set({ status: "ready", user: me.user });
  } catch {
    set({ status: "anon", user: null });
  }
}

/** Vuelve a leer nombre y personaje (después de que el administrador los cambia). */
export async function refreshBrand() {
  try { const { brand } = await get("/api/setup/status"); if (brand) set({ ...state, brand }); } catch { /* queda el anterior */ }
}

export async function login(email: string, password: string) {
  const res = await post("/api/auth/login", { email, password });
  setCsrf(res.csrf);
  set({ status: "ready", user: res.user });
}

export async function setup(email: string, name: string, password: string, setupToken?: string) {
  const res = await post("/api/setup", { email, name, password, setup_token: setupToken || null });
  setCsrf(res.csrf);
  set({ status: "ready", user: res.user });
}

export async function logout() {
  try { await post("/api/auth/logout"); } catch { /* la sesión ya no existía */ }
  setCsrf("");
  set({ status: "anon", user: null });
}

export function passwordChanged(csrf: string) {
  setCsrf(csrf);
  if (state.user) set({ status: "ready", user: { ...state.user, must_change_password: false } });
}

onUnauthorized(() => { if (state.status === "ready") set({ status: "anon", user: null }); });
export const isStaff = (u: User | null) => !!u && (u.role === "admin" || u.role === "editor");
