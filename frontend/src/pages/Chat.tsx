import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ApiError, CHAT_ERRORS, get, post, put, streamChat } from "../api";
import { isStaff, useSession } from "../session";
import { navigate } from "../router";
import { fail, Icon, toast } from "../ui";
import { Buddy, Burst } from "../buddy/Buddy";
import { useCompanion } from "../buddy/useCompanion";
import { Wallpaper } from "../buddy/wallpapers";
import { Customize } from "../buddy/Customize";
import { ACCESSORIES, type Mood } from "../buddy/species";
import { DEFAULT_PREFS, TINTS, bondLevel, moodForExpression, newlyUnlocked, streakMessage, todayLocal, touchStreak, type Prefs, type Species } from "../buddy/personality";
import "../chat.css";
import { DialogBox } from "../gba/DialogBox";
import { playSound } from "../gba/sound";
import { publishGamePrefs } from "../gameState";

type Source = { title: string; owner: string; updated: string; link: string };
type Cfg = { configured: boolean; buddy_name: string; company: string; session_generation: number; species: Species; color: string; default_wallpaper: string; prefs: Prefs };
type Msg = {
  role: "user" | "assistant"; text: string; expression?: string; ring?: string; sources?: Source[];
  ticket?: { title: string; description: string } | null; contact?: { label: string; name: string; contact: string } | null;
  confidence?: string | null; conflict?: boolean; feedback_token?: string | null; feedback?: "up" | "down" | null;
  ticket_key?: string | null; ticket_created?: { id: number } | null; pending?: boolean; error?: string;
};

const REASONS: [string, string][] = [["not_asked", "No era lo que pregunté"], ["wrong", "Dato incorrecto o desactualizado"], ["incomplete", "Incompleta"], ["other", "Otro"]];

export function Chat() {
  const { user } = useSession();
  const first = user?.name.split(" ")[0] ?? "";
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [ideas, setIdeas] = useState<string[]>([]);
  const [customizing, setCustomizing] = useState(false);
  const [gameLines, setGameLines] = useState<string[]>([]);
  const gameTimer = useRef<number | undefined>(undefined);
  const generation = useRef(1);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const typingTimer = useRef<number | undefined>(undefined);
  const pet = useCompanion(cfg?.species ?? "mochi", first);

  const savePrefs = (change: Partial<Prefs>) => {
    const next = { ...prefsRef.current, ...change };
    prefsRef.current = next; setPrefs(next); publishGamePrefs(next);
    put("/api/chat/prefs", change).catch(fail);
  };

  const load = async () => {
    try {
      const [c, h] = await Promise.all([get("/api/chat/config"), get("/api/chat/history")]);
      setCfg(c); generation.current = h.session_generation; setMsgs(h.messages); setLoadError("");
      // Racha de días (perdona un día) y saludo según la hora.
      const touched = touchStreak(c.prefs, todayLocal());
      if (touched.streak !== c.prefs.streak || touched.last_day !== c.prefs.last_day) {
        put("/api/chat/prefs", { streak: touched.streak, last_day: touched.last_day }).catch(() => {});
      }
      setPrefs(touched); publishGamePrefs(touched);
    } catch (e) { setLoadError((e as Error).message); }
  };
  useEffect(() => { load(); get("/api/chat/suggestions").then((r) => setIdeas(r.suggestions)).catch(() => {}); return () => { abort.current?.abort(); clearTimeout(gameTimer.current); }; }, []);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [msgs]);
  useEffect(() => { // el cuadro de texto crece con lo que se escribe
    const el = area.current; if (!el) return; el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 144) + "px";
  }, [text]);

  const greeting = useMemo(() => (cfg ? pet.said("greet") : ""), [cfg?.species, first]);
  const streakNote = useMemo(() => streakMessage(prefs.streak), [prefs.streak]);
  useEffect(() => {
    if (!cfg) return;
    pet.setBase("wave"); pet.react("wave", 2600);
    const t = window.setTimeout(() => pet.setBase("neutral"), 2800);
    return () => clearTimeout(t);
  }, [cfg?.species]);

  const patch = (index: number, change: Partial<Msg>) => setMsgs((list) => list.map((m, i) => (i === index ? { ...m, ...change } : m)));

  // Cada respuesta suma cariño; al cruzar un umbral se desbloquea un accesorio nuevo.
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const grow = () => {
    const before = prefsRef.current.asked;
    const asked = before + 1;
    prefsRef.current = { ...prefsRef.current, asked };
    const unlocked = newlyUnlocked(before, asked);
    savePrefs({ asked });
    if (unlocked.length) {
      const item = ACCESSORIES.find((a) => a.id === unlocked[0]);
      pet.react("love", 3600, pet.said("levelUp", { accessory: item?.name })); pet.celebrate("stars");
      toast(`${cfg?.buddy_name} desbloqueó un accesorio nuevo: ${item?.name}. Probalo en Personalizar.`);
    }
  };

  const send = async (e?: Event, preset?: string) => {
    e?.preventDefault();
    const question = (preset ?? text).trim();
    if (!question || busy) return;
    if (!preset) setText("");
    setBusy(true); pet.setTyping(false);
    clearTimeout(gameTimer.current);
    setGameLines(["¡Apareció una pregunta salvaje!"]);
    gameTimer.current = window.setTimeout(() => setGameLines(["Buddy usó BUSCAR"]), 900);
    pet.setBase("thinking"); pet.activity();
    const base = msgs.length;
    setMsgs((list) => [...list, { role: "user", text: question }, { role: "assistant", text: "", pending: true, expression: "thinking" }]);
    abort.current = new AbortController();
    try {
      await streamChat({ message: question, session_generation: generation.current, request_id: crypto.randomUUID() }, (ev) => {
        if (ev.event === "delta") {
          clearTimeout(gameTimer.current);
          setGameLines(["Buddy está preparando la respuesta…"]);
          setMsgs((list) => list.map((m, i) => (i === base + 1 ? { ...m, text: m.text + ev.data.text } : m)));
        }
        else if (ev.event === "done") {
          clearTimeout(gameTimer.current);
          const count = ev.data.sources?.length ?? 0;
          setGameLines([count ? `¡Buddy encontró ${count} fuentes!` : "Buddy no encontró nada…"]);
          generation.current = ev.data.session_generation ?? generation.current;
          patch(base + 1, { ...ev.data, text: ev.data.answer, pending: false });
          const doubt = ev.data.ring === "doubt";
          const mood = doubt ? "doubt" : moodForExpression(ev.data.expression) === "neutral" ? "happy" : moodForExpression(ev.data.expression);
          pet.setBase("neutral");
          pet.react(mood, 2800, doubt ? pet.said("doubt") : Math.random() < 0.4 ? pet.said("answered") : undefined);
          if (!doubt) grow();
        } else if (ev.event === "error") {
          setGameLines(["No pude completar la búsqueda. Probá de nuevo."]); playSound("error");
          patch(base + 1, { pending: false, error: CHAT_ERRORS[ev.data.error] ?? "No pude responder. Probá de nuevo.", expression: "doubt", text: "" });
          pet.setBase("neutral"); pet.react("sad", 2800);
        }
      }, abort.current.signal);
    } catch (err) {
      setGameLines(["No pude completar la búsqueda. Probá de nuevo."]); playSound("error");
      const code = err instanceof ApiError ? err.code : undefined;
      pet.setBase("neutral");
      if (code === "session_changed") { await load(); }
      else { patch(base + 1, { pending: false, error: (code && CHAT_ERRORS[code]) || (err as Error).message, expression: "doubt", text: "" }); pet.react("sad", 2800); }
    } finally { clearTimeout(gameTimer.current); setBusy(false); area.current?.focus(); }
  };

  const forget = async () => {
    try { const r = await post("/api/chat/forget"); generation.current = r.session_generation; setMsgs([]); pet.react("wave", 2400); } catch (e) { fail(e); }
  };

  const onKey = (e: KeyboardEvent) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) send(e); };
  const onType = (value: string) => {
    setText(value); pet.setTyping(true);
    clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => pet.setTyping(false), 1600);
  };
  const vote = (value: "up" | "down" | null) => {
    if (value === "up") { pet.react("love", 3000, pet.said("thanks")); pet.celebrate("hearts"); }
    else if (value === "down") pet.react("sad", 3000, pet.said("sorry"));
  };

  if (loadError) return <div class="main"><div class="note bad" role="alert">No pude cargar el chat. Revisá tu conexión e intentá de nuevo. <button class="btn small" onClick={load}>Reintentar</button></div></div>;
  if (!cfg) return <div class="main"><p class="faint">Cargando…</p></div>;

  const wallpaper = prefs.wallpaper || cfg.default_wallpaper;
  const tint = TINTS.find((t) => t.id === prefs.tint) ?? TINTS[0];
  const bond = bondLevel(prefs.asked);
  const lastBot = msgs[msgs.length - 1];
  const status = busy || lastBot?.pending ? "escribiendo…" : pet.asleep ? "durmiendo…" : "en línea";
  const accessory = prefs.accessory && ACCESSORIES.some((a) => a.id === prefs.accessory && prefs.asked >= a.unlockAt) ? (prefs.accessory as "bow") : "";
  const mascot = (size: number, mood = pet.mood, cls = "") => (
    <Buddy species={cfg.species} color={cfg.color} mood={mood} accessory={accessory} look={pet.look} size={size} class={cls} label={cfg.buddy_name} />
  );
  const nextItem = bond.next === null ? null : ACCESSORIES.find((a) => a.unlockAt === bond.next);

  return (
    <section class="chat wp" data-wp={wallpaper} style={{ "--mine-l": tint.light, "--mine-d": tint.dark, "--mine-ink-l": tint.ink, "--mine-ink-d": tint.inkDark }} aria-label={`Conversación con ${cfg.buddy_name}`}>
      <div class="wp-layer"><Wallpaper id={wallpaper} /></div>
      <header class="chat-head">
        <button type="button" class="avatar" ref={(n) => { pet.el.current = n; }} onClick={pet.poke} aria-label={`Hacerle cosquillas a ${cfg.buddy_name}`}>
          {mascot(46)}
          <Burst kind={pet.burst.kind} k={pet.burst.k} />
        </button>
        <div class="head-text">
          <h1>{cfg.buddy_name}</h1>
          <span class={`status ${busy ? "typing" : ""}`} aria-live={busy ? "polite" : "off"}>{status}</span>
        </div>
        <button class="btn quiet small" onClick={() => setCustomizing(true)}><Icon name="spark" />Personalizar</button>
        {msgs.length > 0 && <button class="btn quiet small" onClick={forget}><Icon name="new" /><span class="hide-sm">Nueva conversación</span></button>}
        {pet.say && <div class="say" aria-hidden="true" key={pet.say}>{pet.say}</div>}
      </header>
      <div class="chat-scroll" ref={scroller}>
        <div class="thread">
          {prefs.gba && gameLines.length > 0 && <DialogBox lines={gameLines} sound={prefs.sound} />}
          <span class="sr-only" role="status">{lastBot && !lastBot.pending && lastBot.text ? `${cfg.buddy_name} respondió.` : ""}</span>
          {!cfg.configured && (
            <div class="note warn">
              <span>{cfg.buddy_name} todavía no tiene una API key configurada, así que no puede responder.</span>
              {user?.role === "admin" && <button class="btn small" onClick={() => navigate("/admin/ajustes")}>Configurar</button>}
            </div>
          )}
          {msgs.length === 0 && cfg.configured && (
            <div class="welcome">
              <button type="button" class="hero" onClick={pet.poke} aria-label={`Saludar a ${cfg.buddy_name}`}>{mascot(168, pet.asleep ? "sleepy" : "wave")}</button>
              <div class="bubble bot greet"><p>{greeting}</p></div>
              <div class="bond" title="Cada respuesta que recibís le suma cariño a tu Buddy">
                <span class="bond-bar"><i style={{ width: `${Math.round(bond.progress * 100)}%` }} /></span>
                <span>{nextItem ? `Cariño: ${prefs.asked} de ${nextItem.unlockAt} para desbloquear ${nextItem.name.toLowerCase()}` : "Cariño al máximo. Ya tenés todos los accesorios."}</span>
              </div>
              {streakNote && <p class="streak">{streakNote}</p>}
              {ideas.length > 0 && <div class="chips" role="group" aria-label="Preguntas sugeridas">{ideas.map((q) => <button key={q} class="chip" title={q} onClick={(e) => send(e, q)}>{q}</button>)}</div>}
              {ideas.length === 0 && isStaff(user) && <p class="faint">Todavía no hay documentos para consultar. Cargalos desde “Documentos”.</p>}
            </div>
          )}
          {msgs.map((m, i) => <Turn key={i} m={m} answered={m.role === "user" && !!(msgs[i + 1] && (msgs[i + 1].text || msgs[i + 1].error))}
            avatar={(mood) => <Buddy species={cfg.species} color={cfg.color} mood={mood} accessory={accessory} size={38} label="" idle={false} />}
            onPatch={(c) => patch(i, c)} onVote={vote} generation={generation.current} />)}
        </div>
      </div>
      <div class="composer">
        <form onSubmit={send}>
          <label class="sr-only" for="q">Tu pregunta</label>
          <textarea id="q" ref={area} rows={1} maxLength={2000} value={text} placeholder={`Escribile a ${cfg.buddy_name}…`} disabled={!cfg.configured}
            onInput={(e) => onType((e.target as HTMLTextAreaElement).value)} onKeyDown={onKey} />
          <button class="btn primary send" disabled={busy || !text.trim() || !cfg.configured} aria-label="Enviar"><Icon name="send" /></button>
        </form>
        {text.length > 1700 && <div class="counter">{text.length} / 2000</div>}
      </div>
      {customizing && <Customize cfg={cfg} prefs={prefs} onChange={savePrefs} onClose={() => setCustomizing(false)} />}
    </section>
  );
}

function Ticks({ read }: { read: boolean }) {
  return (
    <svg class={`ticks ${read ? "read" : ""}`} viewBox="0 0 18 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-label={read ? "Leído" : "Enviado"} role="img">
      <path d="M1 5.5l3 3L10 1.5" />{read && <path d="M7 6.8l1.2 1.2L14.5 1.5" />}
    </svg>
  );
}

type TurnProps = { m: Msg; answered: boolean; avatar: (mood: Mood) => preact.ComponentChildren; onPatch: (c: Partial<Msg>) => void; onVote: (v: "up" | "down" | null) => void; generation: number };

function Turn({ m, answered, avatar, onPatch, onVote, generation }: TurnProps) {
  if (m.role === "user") return <div class="bubble mine"><span class="body">{m.text}</span><Ticks read={answered} /></div>;
  const doubt = m.ring === "doubt";
  const mood: Mood = m.pending ? "thinking" : m.error ? "sad" : doubt ? "doubt" : moodForExpression(m.expression ?? "neutral");
  return (
    <article class="turn-bot">
      <div class="who">{avatar(mood)}</div>
      <div class="col">
        <div class={`bubble bot ${doubt ? "doubt" : ""}`}>
          {m.error && <div class="note bad" role="alert">{m.error}</div>}
          {m.pending && !m.text && <span class="thinking" aria-label="Está escribiendo"><i /><i /><i /></span>}
          {m.text && <p class="answer">{m.text}</p>}
        </div>
        {!!m.sources?.length && (
          <aside class="margin" aria-label="Fuentes">
            {m.sources.map((s, i) => {
              const inner = <><b>{s.title}</b><span>{[s.owner, s.updated].filter(Boolean).join(" · ")}</span></>;
              return s.link ? <a key={i} class="src" href={s.link} target="_blank" rel="noopener noreferrer">{inner}</a> : <div key={i} class="src">{inner}</div>;
            })}
          </aside>
        )}
        {!m.pending && !m.error && <Extras m={m} onPatch={onPatch} onVote={onVote} generation={generation} />}
      </div>
    </article>
  );
}

function Extras({ m, onPatch, onVote, generation }: { m: Msg; onPatch: (c: Partial<Msg>) => void; onVote: (v: "up" | "down" | null) => void; generation: number }) {
  const [reasons, setReasons] = useState(false);
  const vote = async (value: "up" | "down" | "none", reason?: string) => {
    try { const r = await post("/api/chat/feedback", { token: m.feedback_token, vote: value, reason: reason ?? null }); onPatch({ feedback: r.vote }); if (!reason) onVote(r.vote); }
    catch (e) { fail(e); }
  };
  const ticket = async () => {
    try { const r = await post("/api/chat/ticket", { title: m.ticket!.title, description: m.ticket!.description, request_key: m.ticket_key, session_generation: generation }); onPatch({ ticket_created: r }); }
    catch (e) { fail(e); }
  };
  return (
    <div class="turn-extra">
      {m.conflict && <div class="note warn">Los documentos no dicen lo mismo sobre esto. Conviene confirmarlo con una persona.</div>}
      {!m.conflict && m.confidence === "low" && m.contact && <div class="note warn">Esta respuesta tiene poco respaldo en los documentos.</div>}
      {m.contact && (
        <div class="contact">
          <span>Para confirmarlo:</span><b>{m.contact.name}</b>{m.contact.label && <span>({m.contact.label})</span>}
          {m.contact.contact && <a href={`mailto:${m.contact.contact}`}>{m.contact.contact}</a>}
        </div>
      )}
      {m.ticket && (m.ticket_created
        ? <span class="pill ok">Ticket creado</span>
        : <div><button class="btn small" onClick={ticket}>Crear ticket para que lo resuelva una persona</button></div>)}
      {m.feedback_token && (
        <div class="reacts" role="group" aria-label="¿Te sirvió esta respuesta?">
          <button class="react" aria-pressed={m.feedback === "up"} aria-label="Me sirvió" title="Me sirvió" onClick={() => { setReasons(false); vote(m.feedback === "up" ? "none" : "up"); }}><Icon name="up" /></button>
          <button class="react" aria-pressed={m.feedback === "down"} aria-label="No me sirvió" title="No me sirvió" onClick={() => { if (m.feedback === "down") { vote("none"); setReasons(false); } else { vote("down"); setReasons(true); } }}><Icon name="down" /></button>
          {reasons && m.feedback === "down" && REASONS.map(([code, label]) => <button key={code} class="btn quiet small" onClick={() => { vote("down", code); setReasons(false); }}>{label}</button>)}
          <span class="faint">Tu voto es anónimo.</span>
        </div>
      )}
    </div>
  );
}
