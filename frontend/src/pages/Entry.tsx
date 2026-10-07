import { useState } from "preact/hooks";
import { post } from "../api";
import { login, logout, passwordChanged, setup, useSession } from "../session";
import { Field } from "../ui";
import { Buddy } from "../buddy/Buddy";

function Art() {
  const { brand } = useSession();
  return (
    <aside class="entry-art" aria-hidden="true">
      <Buddy species={brand.species} color={brand.color} mood="wave" size={190} label="" />
      <div>
        <blockquote>Preguntale a tus documentos. Te contesta con lo que dicen, y te muestra de dónde lo sacó.</blockquote>
        <span class="cite">Procedimientos / Vacaciones.docx</span>
      </div>
    </aside>
  );
}

function useSubmit(action: () => Promise<void>) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true); setError("");
    try { await action(); } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  return { error, busy, submit };
}

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { error, busy, submit } = useSubmit(() => login(email, password));
  return (
    <main class="entry">
      <Art />
      <form class="entry-form" onSubmit={submit}>
        <h1>Entrar a {useSession().brand.name}</h1>
        {error && <div class="note bad" role="alert">{error}</div>}
        <Field label="Email" id="email"><input id="email" class="input" type="email" autocomplete="username" required value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} /></Field>
        <Field label="Contraseña" id="pw"><input id="pw" class="input" type="password" autocomplete="current-password" required value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} /></Field>
        <button class="btn primary" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</button>
        <p class="faint">¿Olvidaste tu contraseña? Pedile a un administrador que te dé una nueva.</p>
      </form>
    </main>
  );
}

export function Setup() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const { needsToken } = useSession();
  const { error, busy, submit } = useSubmit(() => setup(email, name, password, token));
  return (
    <main class="entry">
      <Art />
      <form class="entry-form" onSubmit={submit}>
        <div><h1>Bienvenido a {useSession().brand.name}</h1><p class="muted" style="margin-top:.4rem">Creá la cuenta de administrador. Después vas a poder sumar a tu equipo, cargar documentos y conectar tu API key.</p></div>
        {error && <div class="note bad" role="alert">{error}</div>}
        {needsToken && <Field label="Código de instalación" id="token" hint="Es el valor de BUDDY_SETUP_TOKEN que definiste en el servidor."><input id="token" class="input" required autocomplete="off" value={token} onInput={(e) => setToken((e.target as HTMLInputElement).value)} /></Field>}
        <Field label="Tu nombre" id="name"><input id="name" class="input" required maxLength={120} autocomplete="name" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></Field>
        <Field label="Email" id="email"><input id="email" class="input" type="email" required autocomplete="username" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} /></Field>
        <Field label="Contraseña" id="pw" hint="Al menos 10 caracteres."><input id="pw" class="input" type="password" required minLength={10} autocomplete="new-password" value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} /></Field>
        <button class="btn primary" disabled={busy}>{busy ? "Creando…" : "Crear administrador"}</button>
      </form>
    </main>
  );
}

export function ForcePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const { error, busy, submit } = useSubmit(async () => {
    if (next !== again) throw new Error("Las contraseñas nuevas no coinciden.");
    const res = await post("/api/auth/password", { current, new: next });
    passwordChanged(res.csrf);
  });
  return (
    <main class="entry">
      <Art />
      <form class="entry-form" onSubmit={submit}>
        <div><h1>Elegí tu contraseña</h1><p class="muted" style="margin-top:.4rem">Entraste con una contraseña temporal. Cambiala por una tuya para seguir.</p></div>
        {error && <div class="note bad" role="alert">{error}</div>}
        <Field label="Contraseña temporal" id="cur"><input id="cur" class="input" type="password" required autocomplete="current-password" value={current} onInput={(e) => setCurrent((e.target as HTMLInputElement).value)} /></Field>
        <Field label="Contraseña nueva" id="new" hint="Al menos 10 caracteres."><input id="new" class="input" type="password" required minLength={10} autocomplete="new-password" value={next} onInput={(e) => setNext((e.target as HTMLInputElement).value)} /></Field>
        <Field label="Repetí la contraseña nueva" id="again"><input id="again" class="input" type="password" required autocomplete="new-password" value={again} onInput={(e) => setAgain((e.target as HTMLInputElement).value)} /></Field>
        <div class="row"><button class="btn primary" disabled={busy}>Guardar contraseña</button><button type="button" class="btn quiet" onClick={() => logout()}>Salir</button></div>
      </form>
    </main>
  );
}
