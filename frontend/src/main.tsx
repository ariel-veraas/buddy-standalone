import "./styles.css";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { boot, isStaff, logout, useSession } from "./session";
import { navigate, onLink, usePath } from "./router";
import { Icon, Toasts } from "./ui";
import { Buddy } from "./buddy/Buddy";
import { ForcePassword, Login, Setup } from "./pages/Entry";
import { Chat } from "./pages/Chat";
import { Overview } from "./pages/Overview";
import { Quality } from "./pages/Quality";
import { Collections } from "./pages/Collections";
import { Settings } from "./pages/Settings";
import { Users } from "./pages/Users";
import { Support } from "./pages/Support";
import { Audit } from "./pages/Audit";
import { Training } from "./pages/Training";
import { GrowthMoments } from "./gba/GrowthMoments";
import { Buddydex } from "./gba/Buddydex";
import { XpBar } from "./gba/XpBar";
import { Evolution } from "./gba/Evolution";
import { useGameState } from "./gameState";
import "./gba/gba.css";

type Item = { to: string; label: string; icon: string; roles: ("admin" | "editor" | "user")[] };
const NAV: Item[] = [
  { to: "/", label: "Preguntar", icon: "chat", roles: ["admin", "editor", "user"] },
  { to: "/admin", label: "Resumen", icon: "chart", roles: ["admin", "editor"] },
  { to: "/admin/calidad", label: "Calidad", icon: "check", roles: ["admin", "editor"] },
  { to: "/admin/buddydex", label: "Buddydex", icon: "books", roles: ["admin", "editor"] },
  { to: "/admin/entrenamiento", label: "Entrenamiento", icon: "spark", roles: ["admin", "editor"] },
  { to: "/admin/documentos", label: "Documentos", icon: "books", roles: ["admin", "editor"] },
  { to: "/admin/personas", label: "Personas", icon: "users", roles: ["admin"] },
  { to: "/admin/soporte", label: "Contactos y tickets", icon: "mail", roles: ["admin", "editor"] },
  { to: "/admin/ajustes", label: "Ajustes", icon: "gear", roles: ["admin"] },
  { to: "/admin/registro", label: "Registro de actividad", icon: "list", roles: ["admin"] },
];

function Page({ path, role }: { path: string; role: string }) {
  if (path === "/") return <Chat />;
  const staff = role === "admin" || role === "editor";
  if (!staff) return <NotFound />;
  if (path === "/admin") return <Overview />;
  if (path === "/admin/calidad") return <Quality />;
  if (path === "/admin/buddydex") return <Buddydex />;
  if (path === "/admin/entrenamiento") return <Training />;
  if (path === "/admin/documentos") return <Collections />;
  if (path === "/admin/soporte") return <Support />;
  if (role !== "admin") return <NotFound />;
  if (path === "/admin/personas") return <Users />;
  if (path === "/admin/ajustes") return <Settings />;
  if (path === "/admin/registro") return <Audit />;
  return <NotFound />;
}

function NotFound() {
  return <div class="page"><div class="empty"><h3>No encontré esa página</h3><button class="btn" onClick={() => navigate("/")}>Volver al inicio</button></div></div>;
}

function App() {
  const { status, user, brand } = useSession();
  const path = usePath();
  const [evolving, setEvolving] = useState(false);
  const game = useGameState(status === "ready" && !user?.must_change_password ? user?.id : undefined);
  useEffect(() => { boot(); }, []);
  useEffect(() => { document.title = status === "ready" ? brand.name : `${brand.name} · Entrar`; }, [status, brand.name]);

  if (status === "loading") return <p class="faint" style="padding:2rem">Cargando…</p>;
  if (status === "setup") return <Setup />;
  if (status === "anon") return <Login />;
  if (user!.must_change_password) return <ForcePassword />;

  const items = NAV.filter((i) => i.roles.includes(user!.role));
  const isChat = path === "/";
  return (
    <div class="shell">
      <aside class="rail">
        <a class="brand" href="/" onClick={(e) => onLink(e, "/")}><Buddy species={brand.species} color={brand.color} mood="neutral" size={40} label="" />{brand.name}</a>
        {game.growth && <div class="growth-header"><XpBar growth={game.growth} compact /></div>}
        <nav class="nav" aria-label="Principal">
          {items.map((i, n) => (
            <>
              {isStaff(user) && n === 1 && <span class="nav-group">Administración</span>}
              <a key={i.to} href={i.to} aria-current={path === i.to ? "page" : undefined} onClick={(e) => onLink(e, i.to)}><Icon name={i.icon} />{i.label}</a>
            </>
          ))}
        </nav>
        <div class="rail-foot">
          <div class="who"><b>{user!.name}</b><span>{user!.email}</span></div>
          <button class="btn quiet small" onClick={() => logout()}><Icon name="out" />Salir</button>
        </div>
      </aside>
      <main class={isChat ? "" : "main"}><Page path={path} role={user!.role} /></main>
      {game.growth && <Evolution onBusy={setEvolving} key={user!.id} userId={user!.id} stage={game.growth.stage} species={brand.species} color={brand.color} sound={game.prefs.sound} />}
      {game.growth && <GrowthMoments hold={evolving} key={user!.id} userId={user!.id} growth={game.growth} sound={game.prefs.sound}/>}
    </div>
  );
}

render(<><App /><Toasts /></>, document.getElementById("app")!);
