let loading: Promise<unknown> | undefined;
export function loadGameFont() {
  return loading ??= import("@fontsource/pixelify-sans/latin-400.css");
}
