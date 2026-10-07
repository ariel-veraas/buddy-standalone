import { useEffect, useState } from "preact/hooks";

const listeners = new Set<() => void>();
export const path = () => location.pathname.replace(/\/+$/, "") || "/";

export function navigate(to: string, replace = false) {
  if (to === location.pathname) return;
  history[replace ? "replaceState" : "pushState"]({}, "", to);
  listeners.forEach((fn) => fn());
}

addEventListener("popstate", () => listeners.forEach((fn) => fn()));

export function usePath(): string {
  const [value, setValue] = useState(path());
  useEffect(() => {
    const fn = () => setValue(path());
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return value;
}

/** Clic normal navega sin recargar; con Ctrl/Cmd o botón del medio abre como un link común. */
export function onLink(e: MouseEvent, to: string) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(to);
}
