// Buddy personality: pure logic + content (rioplatense Spanish, voseo).
export type Species = "mochi" | "kitsu" | "neko" | "nube" | "conejo" | "osito";
export type LineKind =
  | "greet" | "idle" | "thinking" | "answered" | "doubt" | "thanks" | "sorry"
  | "poke" | "dizzy" | "sleepy" | "wake" | "levelUp" | "typing";
export type Mood =
  | "neutral" | "happy" | "thinking" | "doubt" | "love" | "sleepy"
  | "surprised" | "dizzy" | "sad" | "wave";

export type LineCtx = { name?: string; hour?: number; n?: number; accessory?: string; last?: string };

export const SPECIES: Species[] = ["mochi", "kitsu", "neko", "nube", "conejo", "osito"];

type Band = "morning" | "afternoon" | "night";
type Voice = Record<Exclude<LineKind, "greet" | "poke">, string[]> & {
  greet: Record<Band, string[]>;
  poke: string[]; // 6 lines: [0-1] soft, [2-3] playful, [4-5] about to get dizzy
};

// Tokens: {n} = name, {acc} = accessory label.
const VOICES: Record<Species, Voice> = {
  mochi: {
    greet: {
      morning: ["Buen día, {n}… todavía tengo sueñito, pero me alegra verte.", "Holaaa {n}, soñé con vos y con un té calentito."],
      afternoon: ["Hola {n}, qué bueno que viniste. Justo te estaba pensando.", "Buenas tardes, {n}. ¿Charlamos un ratito?"],
      night: ["Buenas noches, {n}. Qué linda hora para preguntar cositas.", "Hola {n}, la noche es tranqui. Contame qué necesitás."],
    },
    idle: ["Estoy acá, calentito y atento.", "A veces miro las nubes en mi cabeza. Son lindas.", "Cuando quieras, yo te escucho.", "Shhh… estoy soñando despierto."],
    thinking: ["Mmm, dejame buscar en los papeles…", "Estoy hojeando los documentos, ya vuelvo.", "Pensando despacito, así sale mejor.", "Un segundito, que lo estoy soñando… digo, buscando."],
    answered: ["Listo, ahí lo encontré.", "Esto es lo que dicen los documentos.", "Espero que te sirva, {n}.", "Ahí va, con todo mi cariño."],
    doubt: ["Ay, de esto no estoy seguro… prefiero decírtelo.", "No lo encuentro en los documentos, perdoname.", "Mmm, me da dudita. Mejor consultalo con alguien.", "No quiero inventar, así que te digo la verdad: no sé."],
    thanks: ["Ay, gracias a vos. Me hiciste el día.", "Me quedo con el corazón calentito.", "Qué tierno, gracias, {n}.", "Eso me pone feliz, de verdad."],
    sorry: ["Perdón… voy a intentar mejorar.", "Uy, me equivoqué. Gracias por avisarme.", "Lo siento, {n}. Probemos de nuevo.", "Ay, qué pena. Aprendo de esto."],
    poke: ["Ay, cosquillitas.", "Hola, acá estoy.", "Jiji, me hacés cosquillas.", "Otra vez… me gusta.", "Uy, estoy medio mareadito…", "Todo gira, todo gira…"],
    dizzy: ["Uuuf, todo da vueltas…", "Estoy mareadísimo, esperá un poquito.", "Mundo, quedate quieto, por favor.", "Necesito sentarme un rato."],
    sleepy: ["Zzz… me estoy durmiendo…", "Se me cierran los ojitos…", "Una siestita y vuelvo.", "Zzz… cinco minutitos más…"],
    wake: ["¡Ah! Estoy despierto, estoy despierto.", "Mmm… ¿me dormí? Hola otra vez.", "Volví. ¿Me perdí de algo?", "Ya estoy, ya estoy. Contame."],
    levelUp: ["¡Nos queremos más! Desbloqueaste: {acc}.", "Tenemos un vínculo nuevo, {n}. Te regalo: {acc}.", "Mirá lo que apareció: {acc}. Es para vos.", "Crecimos juntos. Ahora tengo: {acc}."],
    typing: ["Te leo, te leo…", "Escribí tranqui, no hay apuro.", "Mmm, ¿qué será?", "Ya casi, ¿no?"],
  },
  kitsu: {
    greet: {
      morning: ["Buen día, {n}. ¿Madrugaste o no dormiste? Igual, me encanta.", "Eh, {n}, arrancaste temprano. Me caés bien."],
      afternoon: ["Mirá quién apareció. Hola {n}, ¿qué travesura traés?", "Buenas, {n}. Tengo la cola lista para ayudarte."],
      night: ["Noche, {n}. La hora de los secretos… de la empresa, claro.", "Ey {n}, las mejores preguntas salen de noche."],
    },
    idle: ["Yo acá, haciéndome el distraído.", "¿Probás a preguntarme algo difícil? Me gusta el desafío.", "Mi cola sabe más de lo que aparenta.", "Estoy tramando algo… bueno, no. Pero suena bien."],
    thinking: ["Husmeando entre los papeles…", "Dejame rastrear esto, tengo buen olfato.", "Ya casi, no me apures.", "Revolviendo documentos sin que se note."],
    answered: ["¿Viste? Te dije que lo encontraba.", "Servido, {n}. De nada.", "Eso dicen los papeles, ni más ni menos.", "Pan comido. ¿Otra?"],
    doubt: ["Esta me la debés: no lo encuentro.", "Ni mi olfato lo encuentra. Mejor no inventar.", "Acá no hay nada claro, preguntale a un humano.", "Me ganaste, {n}. No tengo ese dato."],
    thanks: ["Ja, lo sabía, soy lo mejor.", "Gracias, {n}. Me sonrojé… un poquito.", "Así me gusta, con reconocimiento.", "Anotado en mi lista de favores."],
    sorry: ["Eh, me pasé de listo. Perdón.", "Falló el truco. Lo corrijo.", "Mala mía, {n}. Va de nuevo.", "Ok, esa fue floja. Mejoro."],
    poke: ["Eh, ¿me tocaste la nariz?", "Jaja, buen intento.", "¿Otra vez? Qué insistente.", "Mirá que muerdo… mentira.", "Ey, me estás mareando…", "Basta, que se me enrosca la cola."],
    dizzy: ["Uf, se me enredó la cola.", "Me pasaste de rosca, {n}.", "Giro, giro y no sé dónde estoy.", "Pausa, que me caigo."],
    sleepy: ["Me hago el dormido… o no.", "Un ojo abierto, solo por las dudas.", "Voy a hacerme un ovillo un ratito.", "Zzz… no me tientes."],
    wake: ["¿Qué? No dormía, estaba concentrado.", "Ah, volviste. Justo a tiempo.", "Ya estoy, ya estoy. ¿Qué me perdí?", "Un ojito, dos ojitos… listo."],
    levelUp: ["Subimos de nivel, {n}. Premio: {acc}.", "Me ganaste confianza. Te toca: {acc}.", "Ojo que esto es raro: {acc}, para mí.", "Nivel nuevo, {acc} nuevo. Me queda bien, ¿no?"],
    typing: ["Uy, ¿qué escribís ahí?", "Te espero, pero no mucho.", "Intrigante…", "Dale, que me muero de curiosidad."],
  },
  neko: {
    greet: {
      morning: ["Buen día, {n}. Café primero, preguntas después.", "Ah, {n}. Ya estaba despierto, no creas."],
      afternoon: ["Ey {n}. Hola. Qué onda.", "Tarde tranqui, ¿no? Dale, preguntá."],
      night: ["Noche, {n}. Mi hora favorita.", "Hola {n}. A estas horas es cuando mejor rindo."],
    },
    idle: ["Acá, sin apuro.", "No me mires así, estoy descansando.", "Podría dormir o ayudarte. Veamos qué se da.", "Hago de cuenta que no te estaba esperando."],
    thinking: ["Un momento, que lo busco.", "Dejame ver qué dicen los papeles.", "Calma, calma. Ya va.", "Mirando los documentos con cara de nada."],
    answered: ["Ahí lo tenés.", "Fácil. ¿Qué más?", "Dicho y hecho, {n}.", "Eso es todo. Ni una palabra de más."],
    doubt: ["Eso no lo sé, y no voy a inventar.", "No aparece en los documentos. Tal cual.", "Ni idea, {n}. Preguntale a alguien del equipo.", "Ahí me quedé sin datos. Pasa."],
    thanks: ["Eh… de nada. No es para tanto.", "Ok, me gustó. Pero no se lo cuentes a nadie.", "Gracias, {n}. Ronroneo por dentro.", "Bien. Seguimos."],
    sorry: ["Eh, esa me salió mal. Perdón.", "Tenés razón, me equivoqué.", "Va de nuevo, {n}. Con más cuidado.", "Anotado. No se repite."],
    poke: ["Hm. Sí, acá estoy.", "Ya te vi, ya te vi.", "¿Necesitás algo o solo molestás?", "Seguí así y me voy a otro cojín.", "Eh, basta, que me da vuelta todo.", "Última vez que te dejo, {n}."],
    dizzy: ["Ya está, me mareaste.", "Todo gira. No me gusta nada.", "Necesito un minuto y un rincón.", "Wow. Fuerte. Pausa."],
    sleepy: ["Siesta. No es negociable.", "Cierro los ojos. No me duermo. Zzz.", "Hora de enrollarme un rato.", "Zzz… dejame."],
    wake: ["Ah. Estás acá. Bien.", "Dormía… digo, pensaba.", "Estiramiento listo. Dale.", "Ok, volví. ¿Qué pasó?"],
    levelUp: ["Subimos de nivel. Te dejo: {acc}.", "Está bien, me ganaste. Tomá: {acc}.", "Nuevo detalle: {acc}. Me queda perfecto.", "Confianza ganada, {n}. Premio: {acc}."],
    typing: ["Te escucho. Escribí.", "Dale, sin presión.", "Mmm, ¿y eso?", "Seguí, seguí."],
  },
  nube: {
    greet: {
      morning: ["Buen díaaa, {n}. Flotando se está bien, ¿no?", "Hola {n}. El día recién empieza, tranqui."],
      afternoon: ["Buenas, {n}. Respirá hondo y preguntá.", "Hola {n}. Nada urge, vamos a tu ritmo."],
      night: ["Buenas noches, {n}. Bajemos un cambio.", "Hola {n}. La noche está calma, preguntá nomás."],
    },
    idle: ["Flotando por acá, sin apuro.", "Todo bien, todo tranqui.", "Si necesitás algo, avisame despacito.", "Miro cómo pasa el rato."],
    thinking: ["Veamos con calma…", "Buscando, sin estrés.", "Dejo que las ideas floten hasta acá.", "Un respiro y lo encuentro."],
    answered: ["Ahí está, sin drama.", "Tomá, con calma lo vemos.", "Eso dicen los documentos, {n}.", "Listo. Si no queda claro, lo repetimos."],
    doubt: ["Mmm, eso no lo encuentro, y está bien.", "No tengo ese dato. Nada grave.", "Mejor lo consultamos con alguien, {n}.", "Prefiero no inventar. Tranqui."],
    thanks: ["Qué lindo, gracias.", "Me llevo un buen momento.", "Gracias a vos, {n}. Todo fluye.", "Ay, qué bien se siente."],
    sorry: ["Uy, no salió. Probamos de nuevo, sin culpa.", "Todo bien, lo corrijo.", "Gracias por avisar, {n}.", "Errores pasan. Seguimos."],
    poke: ["Hola, soy una nube, se atraviesa.", "Jeje, cosquillas de aire.", "Me movés un poquito, pero está bien.", "Ya estoy como algodón de azúcar.", "Uh, estoy dando vueltas…", "Me estoy deshilachando, {n}."],
    dizzy: ["Se me mezcló todo el cielo.", "Estoy girando como remolino.", "Respiro… respiro… ya pasa.", "Dame un ratito para asentarme."],
    sleepy: ["Siesta de nube, la mejor.", "Me hago livianito y duermo…", "Zzz… bien suavecito.", "Dejame flotar un rato."],
    wake: ["Ahh… hola otra vez.", "Me desperecé, ya estoy.", "Volví a flotar. ¿Qué pasa?", "Hola de nuevo, sin apuro."],
    levelUp: ["Qué lindo vínculo, {n}. Tengo: {acc}.", "Nuevo regalo: {acc}. Sin apuro, disfrutalo.", "Flotando felices. Ahora tengo: {acc}.", "Crecimos juntos, y hay premio: {acc}."],
    typing: ["Escribí tranquilo, te espero.", "Sin apuro, {n}.", "Mmm, qué interesante.", "Acá sigo, flotando."],
  },
  conejo: {
    greet: {
      morning: ["¡Buen día, {n}! ¡Arrancamos con todo!", "¡Holaaa {n}! ¡Hoy va a estar buenísimo!"],
      afternoon: ["¡Hola {n}! ¡Qué bueno verte! ¿Qué hacemos?", "¡Buenas, {n}! Tengo energía para rato."],
      night: ["¡Noche, {n}! Todavía tengo pilas, ¡dale!", "¡Hola {n}! ¿Último esfuerzo del día?"],
    },
    idle: ["¡Estoy listo para saltar cuando quieras!", "Pum, pum, pum… ¡me muevo solo!", "¿Preguntamos algo? ¡Dale, dale!", "No puedo estar quieto, perdón."],
    thinking: ["¡Buscando a toda velocidad!", "¡Saltando entre los documentos!", "¡Ya casi, ya casi!", "¡Un segundo, estoy en eso!"],
    answered: ["¡Listo! ¡Lo encontré!", "¡Tomá, {n}! ¡Fresquito!", "¡Eso dicen los documentos!", "¡Hecho! ¿Seguimos?"],
    doubt: ["Ay, ¡esto no lo encuentro!", "No sé, ¡y no voy a inventar!", "¡Mejor preguntale a alguien del equipo, {n}!", "Hmm, ¡me quedé sin pistas!"],
    thanks: ["¡Yupi! ¡Gracias, {n}!", "¡Qué alegría!", "¡Me dan ganas de saltar!", "¡Siempre a tu servicio!"],
    sorry: ["¡Uy, perdón! ¡Lo arreglo!", "¡Me equivoqué! ¡Otra vez, dale!", "¡Gracias por avisarme, {n}!", "¡Prometo mejorar!"],
    poke: ["¡Hola, hola!", "¡Jiji, cosquillas!", "¡Dale otra vez, me gusta!", "¡Estoy saltando solo!", "¡Uf, me estoy mareando!", "¡Basta, basta, que giro, {n}!"],
    dizzy: ["¡Giro y giro y giro!", "¡Mareado total!", "¡Pará, pará, que me caigo!", "Dame un segundito… ¡y vuelvo a saltar!"],
    sleepy: ["Ya… ya me duermo… zzz…", "Se acabaron las pilas por hoy…", "Ni saltar puedo… zzz…", "Cinco minutitos… zzz…"],
    wake: ["¡Ah! ¡Volví, volví!", "¡Pilas recargadas!", "¡Hola de nuevo, {n}!", "¡Listo para saltar otra vez!"],
    levelUp: ["¡Subimos de nivel! ¡Tengo: {acc}!", "¡Mirá, mirá, {n}! ¡Desbloqueé: {acc}!", "¡Premio nuevo: {acc}! ¡Qué emoción!", "¡Más amigos todavía! ¡Ahora tengo: {acc}!"],
    typing: ["¡Escribí, escribí, te espero!", "¡Qué emoción!", "¡Dale, dale, dale!", "¡Mmm, ¿qué será?!"],
  },
  osito: {
    greet: {
      morning: ["Buen día, {n}. ¿Desayunaste? Cuidate, ¿sí?", "Hola {n}, vení que te ayudo con lo que necesites."],
      afternoon: ["Hola {n}, acá estoy para lo que haga falta.", "Buenas tardes, {n}. Contame, yo te cuido."],
      night: ["Buenas noches, {n}. No te desveles de más, ¿eh?", "Hola {n}. Preguntá tranqui, yo te acompaño."],
    },
    idle: ["Acá sigo, cuidándote.", "Si necesitás algo, avisame.", "Estoy calentito y atento.", "Me quedo un ratito acompañándote."],
    thinking: ["Voy a revisar bien los papeles.", "Un momento, que lo busco con cuidado.", "Lo hago despacio pero seguro.", "Ya mismo te cuento."],
    answered: ["Tomá, {n}, bien cuidadito.", "Esto dicen los documentos.", "Listo. Si te quedó una duda, preguntame.", "Acá está, espero que te ayude."],
    doubt: ["Uy, de esto no estoy seguro. Mejor no arriesgar.", "No lo encuentro, {n}. Consultalo con alguien del equipo.", "Prefiero decirte que no sé a darte algo equivocado.", "No tengo ese dato, perdoname."],
    thanks: ["Ay, gracias, {n}. Me abrigás el corazón.", "Para eso estoy.", "Me alegra mucho ayudarte.", "Un abrazo grande de oso."],
    sorry: ["Perdón, {n}. Lo vemos de nuevo juntos.", "Tenés razón, me equivoqué.", "Gracias por decírmelo. Voy a cuidar eso.", "Lo siento. Lo arreglo."],
    poke: ["Hola, {n}. Acá estoy.", "Jeje, cosquillas.", "Mirá que soy grandote, eh.", "Ay, ay, me balanceo.", "Eh, me estoy mareando…", "Cuidado, {n}, que me caigo."],
    dizzy: ["Uf, me mareé. Vení, sentémonos.", "Todo da vueltas, {n}.", "Necesito un abrazo y un descanso.", "Quedémonos quietitos un rato."],
    sleepy: ["Me dio sueñito… zzz…", "Un ratito de hibernación.", "Abrigadito y dormido…", "Zzz… cuidame el lugar."],
    wake: ["Ah, hola, {n}. Ya volví.", "Qué buena siesta. ¿Cómo andás?", "Despierto. ¿Me necesitabas?", "Listo, acá estoy otra vez."],
    levelUp: ["Qué lindo vínculo, {n}. Te regalo: {acc}.", "Ganaste mi confianza. Desbloqueaste: {acc}.", "Un detalle para nosotros: {acc}.", "Crecemos juntos. Ahora tengo: {acc}."],
    typing: ["Escribí tranquilo, {n}.", "Te espero, sin apuro.", "Acá estoy, leyendo.", "Dale, que te escucho."],
  },
};

const ACCESSORY_LABEL: Record<string, string> = {
  bow: "un moño",
  hat: "un gorrito",
  glasses: "unos anteojos",
  crown: "una corona",
};

export function bandForHour(hour: number): Band {
  if (hour >= 5 && hour < 13) return "morning";
  if (hour >= 13 && hour < 20) return "afternoon";
  return "night";
}

function fill(t: string, ctx: LineCtx): string {
  const name = ctx.name?.trim();
  const acc = (ctx.accessory && ACCESSORY_LABEL[ctx.accessory]) || ctx.accessory || "algo nuevo";
  let s = t.replace("{acc}", acc);
  s = name ? s.replace(/\{n\}/g, name) : s.replace(/,? ?\{n\}/g, "");
  return s.replace(/\s+([,.!?…])/g, "$1").replace(/\s{2,}/g, " ").replace(/^[,.\s]+/, "").trim();
}

function candidates(species: Species, kind: LineKind, ctx: LineCtx): string[] {
  const v = VOICES[species] ?? VOICES.mochi;
  if (kind === "greet") return v.greet[bandForHour(ctx.hour ?? new Date().getHours())];
  if (kind === "poke") {
    const n = ctx.n ?? 1;
    return n <= 2 ? v.poke.slice(0, 2) : n <= 5 ? v.poke.slice(2, 4) : v.poke.slice(4, 6);
  }
  return v[kind];
}

export function line(
  species: Species,
  kind: LineKind,
  ctx: LineCtx = {},
  rng: () => number = Math.random,
): string {
  const pool = candidates(species, kind, ctx).map((t) => fill(t, ctx));
  let options = ctx.last ? pool.filter((p) => p !== ctx.last) : pool;
  if (options.length === 0) options = pool;
  const i = Math.min(options.length - 1, Math.floor(rng() * options.length));
  return options[i];
}

/** All raw templates for a species/kind (used by tests). */
export function allLines(species: Species, kind: LineKind): string[] {
  const v = VOICES[species];
  if (kind === "greet") return [...v.greet.morning, ...v.greet.afternoon, ...v.greet.night];
  return v[kind];
}

export function moodForExpression(expr: string): Mood {
  switch (expr) {
    case "happy":
    case "wink":
      return "happy";
    case "thinking":
      return "thinking";
    case "surprised":
      return "surprised";
    case "doubt":
      return "doubt";
    default:
      return "neutral";
  }
}

// ---- Affection and levels ----
export const ACCESSORY_UNLOCKS = { bow: 5, hat: 20, glasses: 50, crown: 100 } as const;

export function unlockedAccessories(asked: number): string[] {
  return Object.entries(ACCESSORY_UNLOCKS).filter(([, n]) => asked >= n).map(([k]) => k);
}

export function newlyUnlocked(before: number, after: number): string[] {
  return Object.entries(ACCESSORY_UNLOCKS).filter(([, n]) => before < n && after >= n).map(([k]) => k);
}

export function bondLevel(asked: number): { level: number; next: number | null; progress: number } {
  const steps = [0, ...Object.values(ACCESSORY_UNLOCKS)];
  let level = 0;
  for (let i = 0; i < steps.length; i++) if (asked >= steps[i]) level = i;
  const next = level + 1 < steps.length ? steps[level + 1] : null;
  const base = steps[level];
  const progress = next === null ? 1 : Math.max(0, Math.min(1, (asked - base) / (next - base)));
  return { level, next, progress };
}

// ---- Prefs and streak ----
export type Prefs = {
  gba: boolean;
  sound: boolean;
  wallpaper: string;
  tint: string;
  accessory: string;
  asked: number;
  streak: number;
  last_day: string;
};
export const DEFAULT_PREFS: Prefs = { gba: false, sound: false, wallpaper: "", tint: "azul", accessory: "", asked: 0, streak: 0, last_day: "" };

export function todayLocal(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function dayNumber(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
}

/** Streak with 1 day of grace: a gap of 1 or 2 days continues, more resets to 1. */
export function touchStreak(prefs: Prefs, today: string): Prefs {
  const a = dayNumber(prefs.last_day);
  const b = dayNumber(today);
  if (b === null) return prefs;
  if (a === null || prefs.streak < 1) return { ...prefs, streak: 1, last_day: today };
  const gap = b - a;
  if (gap <= 0) return prefs.last_day === today ? prefs : { ...prefs, last_day: today };
  if (gap <= 2) return { ...prefs, streak: prefs.streak + 1, last_day: today };
  return { ...prefs, streak: 1, last_day: today };
}

const MILESTONES = [3, 7, 14, 30];
export function streakMessage(streak: number): string | null {
  const hit = MILESTONES.includes(streak) || (streak > 30 && streak % 30 === 0);
  if (!hit) return null;
  return streak >= 30
    ? `¡${streak} días juntos! Sos de mis personas favoritas.`
    : `¡${streak} días seguidos charlando! Me encanta verte por acá.`;
}

// ---- Bubble tints (the person's bubble). Text contrast >= 4.5 is checked in tests. ----
export type Tint = { id: string; name: string; light: string; dark: string; ink: string; inkDark: string };
export const TINTS: Tint[] = [
  { id: "azul", name: "Azul", light: "#cfe0fb", dark: "#26406e", ink: "#10213f", inkDark: "#eaf1ff" },
  { id: "rosa", name: "Rosa", light: "#fbd3e0", dark: "#6b2a45", ink: "#43111f", inkDark: "#ffe9f0" },
  { id: "menta", name: "Menta", light: "#cbeedd", dark: "#1f5a43", ink: "#0d3324", inkDark: "#e2fbef" },
  { id: "durazno", name: "Durazno", light: "#fbdcc4", dark: "#6a3d1f", ink: "#44230c", inkDark: "#ffeede" },
  { id: "lila", name: "Lila", light: "#e1d6f8", dark: "#46346f", ink: "#2a1b4d", inkDark: "#f1eaff" },
  { id: "limon", name: "Limón", light: "#f3efb2", dark: "#575319", ink: "#383508", inkDark: "#fbf8c9" },
];
