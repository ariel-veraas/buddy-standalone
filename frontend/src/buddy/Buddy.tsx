import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";
import "./buddy.css";
import { ACCESSORIES, COLORS, SPECIES } from "./species";
import type { Accessory, Mood, Species } from "./species";

export type { Accessory, Mood, Species } from "./species";

export interface BuddyProps {
  species: Species;
  color?: string;
  mood?: Mood;
  accessory?: Accessory | "";
  /** Where the eyes look, each axis in -1..1. null = wander on their own. */
  look?: { x: number; y: number } | null;
  size?: number | string;
  class?: string;
  onClick?: () => void;
  label?: string;
  /** Default true: breathe, blink, sway. False = fully still. */
  idle?: boolean;
}

let instanceSeq = 0;

const INK = "#2b2233";
const clamp = (n: number) => Math.max(-1, Math.min(1, n));

/** Y of the top of the head per species (accessories sit there). */
const HEAD_TOP: Record<Species, number> = { mochi: 24, kitsu: 31, neko: 33, nube: 31, conejo: 43, osito: 31 };
/** Y of the mouth per species. */
const MOUTH_Y: Record<Species, number> = { mochi: 77, kitsu: 77, neko: 76, nube: 77, conejo: 77, osito: 80 };
/** Position of the soft highlight on the body. */
const SHINE: Record<Species, [number, number]> = {
  mochi: [42, 46],
  kitsu: [40, 52],
  neko: [40, 52],
  nube: [48, 46],
  conejo: [40, 60],
  osito: [40, 50],
};

function Ear({ side, children }: { side: "l" | "r"; children: ComponentChildren }) {
  const inner = (
    <g class="bd-earpose">
      <g class={`bd-ear bd-ear-${side}`}>{children}</g>
    </g>
  );
  return side === "l" ? inner : <g transform="matrix(-1 0 0 1 120 0)">{inner}</g>;
}

function Eye({ x }: { x: number }) {
  return (
    <g transform={`translate(${x} 64)`}>
      <g class="bd-ev bd-ev-open">
        <g class="bd-look">
          <g class="bd-wander">
            <g class="bd-blink">
              <ellipse rx="6.4" ry="7.8" fill={INK} />
              <circle cx="-2" cy="-2.8" r="2.6" fill="#fff" />
              <circle cx="2.3" cy="2.7" r="1.2" fill="#fff" opacity="0.9" />
            </g>
          </g>
        </g>
      </g>
      <path class="bd-ev bd-ev-happy" d="M-6.5 2.5 Q0 -7 6.5 2.5" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
      <path class="bd-ev bd-ev-closed" d="M-6.5 -1.5 Q0 5 6.5 -1.5" fill="none" stroke={INK} strokeWidth="2.8" strokeLinecap="round" />
      <g class="bd-ev bd-ev-love">
        <g class="bd-beat">
          <path d="M0 7 C-10 -1 -7 -9 0 -3.5 C7 -9 10 -1 0 7Z" fill="#ff5a8a" />
          <circle cx="-3" cy="-2.4" r="1.6" fill="#fff" opacity="0.85" />
        </g>
      </g>
      <g class="bd-ev bd-ev-dizzy">
        <g class="bd-spin">
          <path
            d="M0 0 a1.5 1.5 0 0 1 3 0 a3 3 0 0 1 -6 0 a4.5 4.5 0 0 1 9 0 a6 6 0 0 1 -12 0"
            transform="translate(-1.5 0)"
            fill="none"
            stroke={INK}
            strokeWidth="1.9"
            strokeLinecap="round"
          />
        </g>
      </g>
    </g>
  );
}

function Face({ species }: { species: Species }) {
  const my = MOUTH_Y[species];
  return (
    <g class="bd-face">
      {/* eyebrows */}
      <g transform="translate(44 52)">
        <path class="bd-brow bd-brow-l" d="M-6 0.5 Q0 -2 6 0.5" />
      </g>
      <g transform="translate(76 52)">
        <path class="bd-brow bd-brow-r" d="M-6 0.5 Q0 -2 6 0.5" />
      </g>
      <Eye x={44} />
      <Eye x={76} />
      <ellipse class="bd-cheek" cx="31" cy="75" rx="7.5" ry="4.6" />
      <ellipse class="bd-cheek" cx="89" cy="75" rx="7.5" ry="4.6" />
      <g transform={`translate(60 ${my})`}>
        <path class="bd-mo bd-mo-smile" d="M-4.5 0 Q0 4.6 4.5 0" fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
        <g class="bd-mo bd-mo-big">
          <path d="M-7 -1 Q0 2 7 -1 Q6.5 9.5 0 9.5 Q-6.5 9.5 -7 -1Z" fill="#3a2430" />
          <ellipse cx="0" cy="6.8" rx="3.6" ry="2.2" fill="#ff8fa5" />
        </g>
        <g class="bd-mo bd-mo-o" transform="translate(0 2)">
          <ellipse class="bd-mo-o-s" rx="2.8" ry="3.4" fill="#3a2430" />
        </g>
        <path class="bd-mo bd-mo-wavy" d="M-6 1 Q-3 -2.2 0 1 T6 1" fill="none" stroke={INK} strokeWidth="2.3" strokeLinecap="round" />
        <path class="bd-mo bd-mo-frown" d="M-4.5 3.2 Q0 -1.8 4.5 3.2" fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
      </g>
    </g>
  );
}

/** Species-specific parts: behind the body, the body, and things in front of it. */
function parts(species: Species, g: string, clip: string) {
  switch (species) {
    case "mochi":
      return {
        back: null,
        body: <path d="M60 22 C86 22 104 56 106 84 C107 101 90 108 60 108 C30 108 13 101 14 84 C16 56 34 22 60 22Z" fill={g} />,
        front: (
          <g class="bd-leaf">
            <path d="M60 26 C60 21 60 19 61 16" stroke="#3fa86c" strokeWidth="2.2" strokeLinecap="round" fill="none" />
            <path d="M60 25 C52 9 36 9 31 16 C40 27 54 29 60 25Z" fill="#7be09c" />
            <path d="M58 24 Q46 18 36 16.5" stroke="#3fa86c" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.7" />
            <path d="M61 24 C64 12 76 8 83 12 C79 23 68 28 61 24Z" fill="#62d68b" />
          </g>
        ),
        face: null,
      };
    case "kitsu":
      return {
        back: (
          <>
            <g class="bd-tail">
              <path d="M88 102 C112 108 128 86 121 58 C119 50 115 44 108 39 C109 56 101 70 82 82Z" fill={g} />
              <path d="M108 39 C115 44 119 50 121 58 C123 65 122 71 120 76 C114 69 107 62 102 58 C106 53 108 46 108 39Z" class="bd-light" />
            </g>
            <Ear side="l">
              <path d="M21 52 C18 36 20 22 25 9 C27 5 30 6 33 8 C42 15 49 24 53 36Z" fill={g} />
              <path d="M25 11 C27 8 30 8 32 9 C34 11 35 12 36 14 C31 15 28 18 26 22 C25 18 25 14 25 11Z" class="bd-dark" />
              <path d="M28 40 C27 32 28 26 30 21 C36 26 41 31 44 37Z" class="bd-inner" />
            </Ear>
          </>
        ),
        body: <ellipse cx="60" cy="70" rx="44" ry="38" fill={g} />,
        front: (
          <g clipPath={`url(#${clip})`}>
            <path
              class="bd-light"
              d="M14 86 C22 78 30 76 35 70 C42 74 50 71 60 69 C70 71 78 74 85 70 C90 76 98 78 106 86 C100 106 82 112 60 112 C38 112 20 106 14 86Z"
            />
          </g>
        ),
        face: <path class="bd-nose-fill" d="M57 70 H63 L60 73.4Z" fill="#3a2430" strokeLinejoin="round" stroke="#3a2430" strokeWidth="1.6" />,
        ear2: (
          <Ear side="r">
            <path d="M21 52 C18 36 20 22 25 9 C27 5 30 6 33 8 C42 15 49 24 53 36Z" fill={g} />
            <path d="M25 11 C27 8 30 8 32 9 C34 11 35 12 36 14 C31 15 28 18 26 22 C25 18 25 14 25 11Z" class="bd-dark" />
            <path d="M28 40 C27 32 28 26 30 21 C36 26 41 31 44 37Z" class="bd-inner" />
          </Ear>
        ),
      };
    case "neko":
      return {
        back: (
          <>
            <g class="bd-tail">
              <path d="M26 100 C4 100 -2 76 10 64" fill="none" stroke="var(--b2)" strokeWidth="15" strokeLinecap="round" />
              <path d="M26 100 C4 100 -2 76 10 64" fill="none" stroke={g} strokeWidth="11.5" strokeLinecap="round" />
            </g>
            <Ear side="l">
              <path d="M20 54 C17 40 18 28 23 19 C25 15 28 15 31 17 C40 22 47 29 52 38Z" fill={g} />
              <path d="M26 42 C25 35 26 29 28 25 C34 28 39 32 43 38Z" class="bd-inner" />
            </Ear>
          </>
        ),
        body: <ellipse cx="60" cy="71" rx="45" ry="37" fill={g} />,
        front: (
          <g class="bd-stripes" stroke="var(--b2)" strokeWidth="2.6" strokeLinecap="round" fill="none">
            <path d="M60 36 V43" />
            <path d="M52 38 L53.5 44" />
            <path d="M68 38 L66.5 44" />
          </g>
        ),
        face: (
          <>
            <path class="bd-nose-fill" d="M57.2 69.6 H62.8 L60 73Z" fill="var(--a)" stroke="var(--a)" strokeWidth="1.6" strokeLinejoin="round" />
            <g class="bd-whisk" stroke="var(--b2)" strokeWidth="1.7" strokeLinecap="round" fill="none" opacity="0.85">
              <path d="M24 72 L8 68" />
              <path d="M24 77 L7 78" />
              <path d="M96 72 L112 68" />
              <path d="M96 77 L113 78" />
            </g>
          </>
        ),
        ear2: (
          <Ear side="r">
            <path d="M20 54 C17 40 18 28 23 19 C25 15 28 15 31 17 C40 22 47 29 52 38Z" fill={g} />
            <path d="M26 42 C25 35 26 29 28 25 C34 28 39 32 43 38Z" class="bd-inner" />
          </Ear>
        ),
      };
    case "nube":
      return {
        back: null,
        body: (
          <g fill={g}>
            <circle cx="34" cy="80" r="21" />
            <circle cx="87" cy="79" r="22" />
            <circle cx="60" cy="57" r="26" />
            <circle cx="40" cy="64" r="17" />
            <circle cx="80" cy="63" r="18" />
            <ellipse cx="60" cy="86" rx="38" ry="22" />
          </g>
        ),
        front: (
          <>
            <g transform="translate(12 38)"><path class="bd-spark bd-spark-1" d="M0 -6 L1.6 -1.6 L6 0 L1.6 1.6 L0 6 L-1.6 1.6 L-6 0 L-1.6 -1.6Z" /></g>
            <g transform="translate(108 52)"><path class="bd-spark bd-spark-2" d="M0 -5 L1.4 -1.4 L5 0 L1.4 1.4 L0 5 L-1.4 1.4 L-5 0 L-1.4 -1.4Z" /></g>
          </>
        ),
        face: null,
      };
    case "conejo":
      return {
        back: (
          <>
            <Ear side="l">
              <g transform="rotate(-7 44 40)">
                <ellipse cx="44" cy="22" rx="10" ry="24" fill={g} />
                <ellipse cx="44" cy="24" rx="5.2" ry="17" class="bd-inner" />
              </g>
            </Ear>
          </>
        ),
        body: <ellipse cx="60" cy="76" rx="43" ry="32" fill={g} />,
        front: <ellipse class="bd-light" cx="60" cy="97" rx="22" ry="9" opacity="0.7" />,
        face: (
          <>
            <path class="bd-nose-fill" d="M57.4 69.6 H62.6 L60 72.6Z" fill="var(--a)" stroke="var(--a)" strokeWidth="1.6" strokeLinejoin="round" />
            <path class="bd-teeth" d="M57 80.5 H63 V86 Q60 87.6 57 86Z" fill="#fff" stroke="#e5d6dc" strokeWidth="0.8" />
          </>
        ),
        ear2: (
          <Ear side="r">
            <g transform="rotate(-7 44 40)">
              <ellipse cx="44" cy="22" rx="10" ry="24" fill={g} />
              <ellipse cx="44" cy="24" rx="5.2" ry="17" class="bd-inner" />
            </g>
          </Ear>
        ),
      };
    case "osito":
      return {
        back: (
          <>
            <Ear side="l">
              <circle cx="25" cy="38" r="13" fill={g} />
              <circle cx="26" cy="39" r="7" class="bd-inner" />
            </Ear>
          </>
        ),
        body: <ellipse cx="60" cy="70" rx="45" ry="38" fill={g} />,
        front: <ellipse class="bd-light" cx="60" cy="81" rx="18" ry="13.5" />,
        face: <ellipse cx="60" cy="73.2" rx="4.6" ry="3.3" fill="#3a2430" />,
        ear2: (
          <Ear side="r">
            <circle cx="25" cy="38" r="13" fill={g} />
            <circle cx="26" cy="39" r="7" class="bd-inner" />
          </Ear>
        ),
      };
  }
}

function Arms() {
  return (
    <>
      <g class="bd-arm bd-arm-l">
        <ellipse cx="19" cy="90" rx="6.8" ry="10.5" transform="rotate(14 19 90)" fill="var(--b)" stroke="var(--b2)" strokeWidth="1.4" />
      </g>
      <g class="bd-arm bd-arm-r">
        <ellipse cx="101" cy="90" rx="6.8" ry="10.5" transform="rotate(-14 101 90)" fill="var(--b)" stroke="var(--b2)" strokeWidth="1.4" />
      </g>
    </>
  );
}

const DK = "#3b3350";

function Acc({ accessory, species }: { accessory: Accessory; species: Species }) {
  const top = HEAD_TOP[species];
  if (accessory === "glasses") {
    return (
      <g class="bd-acc bd-acc-glasses">
        <circle cx="44" cy="64" r="11.5" fill="#fff" fillOpacity="0.2" stroke={DK} strokeWidth="2.6" />
        <circle cx="76" cy="64" r="11.5" fill="#fff" fillOpacity="0.2" stroke={DK} strokeWidth="2.6" />
        <path d="M55.5 62 Q60 59 64.5 62" fill="none" stroke={DK} strokeWidth="2.4" strokeLinecap="round" />
        <path d="M32.5 62 L27 60 M87.5 62 L93 60" stroke={DK} strokeWidth="2.2" strokeLinecap="round" />
        <path d="M37 59 Q39 55.5 43 55" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" opacity="0.8" />
        <path d="M69 59 Q71 55.5 75 55" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" opacity="0.8" />
      </g>
    );
  }
  if (accessory === "bow") {
    return (
      <g transform={`translate(${species === "conejo" || species === "mochi" ? 78 : 82} ${top + 7}) rotate(14)`}>
        <g class="bd-acc">
          <path d="M0 0 C-7 -10 -18 -8 -16 1 C-15 8 -6 6 0 0Z" fill="#ff6f9c" stroke="#c2416f" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M0 0 C7 -10 18 -8 16 1 C15 8 6 6 0 0Z" fill="#ff6f9c" stroke="#c2416f" strokeWidth="1.4" strokeLinejoin="round" />
          <circle r="3.6" fill="#ff8fb4" stroke="#c2416f" strokeWidth="1.4" />
        </g>
      </g>
    );
  }
  if (accessory === "hat") {
    return (
      <g transform={`translate(66 ${top + 4}) rotate(12)`}>
        <g class="bd-acc">
          <path d="M-14 3 L0 -34 L14 3 Q0 8 -14 3Z" fill="#8e9bff" stroke={DK} strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M-9 -9 Q0 -5 9 -9" fill="none" stroke="#ffe27a" strokeWidth="3" strokeLinecap="round" />
          <circle cx="-3" cy="-18" r="1.8" fill="#ffe27a" />
          <circle cx="4" cy="-3" r="1.8" fill="#ffe27a" />
          <circle cx="0" cy="-35" r="4.6" fill="#ffe27a" stroke={DK} strokeWidth="1.4" />
        </g>
      </g>
    );
  }
  return (
    <g transform={`translate(60 ${top + 6})`}>
      <g class="bd-acc">
        <path d="M-16 4 L-19 -15 L-9 -7 L0 -20 L9 -7 L19 -15 L16 4 Q0 8 -16 4Z" fill="#ffd45e" stroke="#b9831a" strokeWidth="1.6" strokeLinejoin="round" />
        <circle cx="0" cy="-3" r="2.6" fill="#ff6f9c" stroke="#b9831a" strokeWidth="1" />
        <circle cx="-9" cy="-1" r="1.8" fill="#7cc7ff" />
        <circle cx="9" cy="-1" r="1.8" fill="#7cc7ff" />
      </g>
    </g>
  );
}

/** Small effects that live inside the SVG (thought dots, z's, tear, hearts). */
function Fx() {
  const bubble = { fill: "var(--b)", stroke: "var(--b2)", strokeWidth: 1.4 };
  const zStyle = { fill: "var(--b)", stroke: "var(--b2)", strokeWidth: 2.4, paintOrder: "stroke" } as const;
  return (
    <g class="bd-fx">
      <g class="bd-fx-think">
        <circle class="bd-dot bd-dot-1" cx="90" cy="30" r="2.4" {...bubble} />
        <circle class="bd-dot bd-dot-2" cx="99" cy="21" r="3.4" {...bubble} />
        <circle class="bd-dot bd-dot-3" cx="110" cy="10" r="4.6" {...bubble} />
      </g>
      <g class="bd-fx-sleep">
        <text class="bd-z bd-z-1" x="88" y="30" fontSize="15" fontWeight="800" style={zStyle}>z</text>
        <text class="bd-z bd-z-2" x="98" y="20" fontSize="12" fontWeight="800" style={zStyle}>z</text>
        <text class="bd-z bd-z-3" x="106" y="11" fontSize="9" fontWeight="800" style={zStyle}>z</text>
      </g>
      <g class="bd-fx-sad">
        <path class="bd-tear" d="M36 71 C34 75 33.5 77 36 79 C38.5 77 38 75 36 71Z" fill="#9bd8ff" stroke="#5aa7e0" strokeWidth="1" />
      </g>
      <g class="bd-fx-love">
        <g transform="translate(94 30) scale(0.9)"><path class="bd-lh bd-lh-1" d="M0 6 C-9 -1 -6 -8 0 -3 C6 -8 9 -1 0 6Z" fill="#ff7aa2" /></g>
        <g transform="translate(24 24) scale(0.65)"><path class="bd-lh bd-lh-2" d="M0 6 C-9 -1 -6 -8 0 -3 C6 -8 9 -1 0 6Z" fill="#ff9fbe" /></g>
      </g>
    </g>
  );
}

export function Buddy(props: BuddyProps) {
  const { species, mood = "neutral", look = null, idle = true } = props;
  const accessory = props.accessory || "";
  const idRef = useRef(0);
  if (!idRef.current) idRef.current = ++instanceSeq;
  const n = idRef.current;
  const pokeRef = useRef<SVGGElement>(null);

  const sp = SPECIES.find((s) => s.id === species) ?? SPECIES[0];
  const colorId = props.color || sp.defaultColor;
  const col = COLORS.find((c) => c.id === colorId) ?? COLORS.find((c) => c.id === sp.defaultColor) ?? COLORS[0];

  // Where the pupils go: some moods force a gaze, otherwise follow `look`.
  let gaze = look;
  if (mood === "thinking") gaze = { x: 0.75, y: -0.8 };
  else if (mood === "doubt") gaze = { x: -0.65, y: 0.25 };
  else if (mood === "sad") gaze = { x: 0, y: 0.7 };
  const lx = gaze ? clamp(gaze.x) * 2.7 : 0;
  const ly = gaze ? clamp(gaze.y) * 2.2 : 0;

  const gid = `bd${n}-g`;
  const cid = `bd${n}-c`;
  const { back, body, front, face, ear2 } = parts(species, `url(#${gid})`, cid) as {
    back: ComponentChildren;
    body: ComponentChildren;
    front: ComponentChildren;
    face: ComponentChildren;
    ear2?: ComponentChildren;
  };
  const [sx, sy] = SHINE[species];
  const sizeCss = props.size === undefined ? "" : typeof props.size === "number" ? `${props.size}px` : props.size;

  const style =
    `--b:${col.body};--b2:${col.shade};--a:${col.accent};--lx:${lx.toFixed(2)}px;--ly:${ly.toFixed(2)}px;` +
    `--bl:${(3.6 + ((n * 37) % 29) / 10).toFixed(1)}s;--bd:${(-((n * 53) % 47) / 10).toFixed(1)}s;` +
    `--e1:${(5 + ((n * 17) % 13) / 5).toFixed(1)}s;--e2:${(6 + ((n * 29) % 11) / 4).toFixed(1)}s;` +
    (sizeCss ? `width:${sizeCss};height:${sizeCss};` : "");

  const cls = [
    "bd",
    `bd-sp-${species}`,
    `bd-m-${mood}`,
    idle ? "bd-live" : "",
    idle && !gaze ? "bd-roam" : "",
    species === "mochi" && (accessory === "hat" || accessory === "crown") ? "bd-noleaf" : "",
    props.onClick ? "bd-click" : "",
    props.class ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const label =
    props.label ?? `${sp.name}${accessory ? `, con ${ACCESSORIES.find((a) => a.id === accessory)?.name.toLowerCase() ?? ""}` : ""}`;

  const handleClick = () => {
    const el = pokeRef.current;
    if (el) {
      el.classList.remove("bd-poked");
      void el.getBoundingClientRect();
      el.classList.add("bd-poked");
    }
    props.onClick?.();
  };

  return (
    <svg
      class={cls}
      style={style}
      viewBox="0 0 120 120"
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      onClick={props.onClick ? handleClick : undefined}
    >
      <defs>
        <radialGradient id={gid} gradientUnits="userSpaceOnUse" cx="46" cy="42" r="92">
          <stop offset="0" style="stop-color:var(--b)" />
          <stop offset="0.55" style="stop-color:var(--b)" />
          <stop offset="1" style="stop-color:var(--b2)" />
        </radialGradient>
        <clipPath id={cid}>
          {species === "kitsu" ? <ellipse cx="60" cy="70" rx="44" ry="38" /> : null}
        </clipPath>
      </defs>
      <ellipse class="bd-shadow" cx="60" cy="110" rx="33" ry="5" />
      <g
        class="bd-poke"
        ref={pokeRef}
        onAnimationEnd={(e) => (e.currentTarget as SVGGElement).classList.remove("bd-poked")}
      >
        <g class="bd-pose">
          <g class="bd-float">
            <g class="bd-body">
              {back}
              {ear2}
              {body}
              <ellipse class="bd-shine" cx={sx} cy={sy} rx="12" ry="6.5" transform={`rotate(-32 ${sx} ${sy})`} />
              {front}
              <Arms />
              {face}
              <Face species={species} />
              {accessory ? <Acc accessory={accessory} species={species} /> : null}
            </g>
          </g>
          <Fx />
        </g>
      </g>
    </svg>
  );
}

type BurstKind = "hearts" | "stars" | "zzz";

// Fixed trajectories so a burst always looks balanced (dx, dy, rotation, delay, scale).
const FLIGHTS: [number, number, number, number, number][] = [
  [-34, -62, -18, 0, 1],
  [30, -70, 16, 0.06, 0.85],
  [-8, -84, 6, 0.12, 1.1],
  [48, -44, 24, 0.18, 0.7],
  [-52, -40, -26, 0.22, 0.75],
  [14, -56, -8, 0.3, 0.6],
  [-24, -50, 12, 0.36, 0.65],
];

function BurstShape({ kind }: { kind: BurstKind }) {
  if (kind === "hearts")
    return (
      <svg viewBox="0 0 24 24">
        <path d="M12 21.5 C4 16 2.5 11 4.6 7.6 C6.6 4.6 10.4 5 12 8.2 C13.6 5 17.4 4.6 19.4 7.6 C21.5 11 20 16 12 21.5Z" fill="#ff6b95" stroke="#e23d70" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    );
  if (kind === "stars")
    return (
      <svg viewBox="0 0 24 24">
        <path d="M12 2.2 L14.8 8.6 L21.8 9.3 L16.5 13.9 L18.1 20.8 L12 17.2 L5.9 20.8 L7.5 13.9 L2.2 9.3 L9.2 8.6Z" fill="#ffd45e" stroke="#e0a21f" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24">
      <text x="12" y="19" textAnchor="middle" fontSize="22" fontWeight="800" fill="#a9b8ff" stroke="#6f7fe0" strokeWidth="1.6" paintOrder="stroke" style="font-family:var(--sans,system-ui),sans-serif">z</text>
    </svg>
  );
}

/**
 * One-shot particles that fly out and fade. Place inside a `position: relative` box;
 * restarts whenever `k` changes (k <= 0 renders nothing).
 */
export function Burst({ kind, k }: { kind: BurstKind; k: number }) {
  if (k <= 0) return null;
  const list = kind === "zzz" ? FLIGHTS.slice(0, 3) : FLIGHTS;
  return (
    <span class="bd-burst" aria-hidden="true" key={k}>
      {list.map(([dx, dy, r, d, s], i) => (
        <i
          key={i}
          class="bd-bp"
          style={`--dx:${kind === "zzz" ? dx * 0.35 : dx}px;--dy:${kind === "zzz" ? dy * 0.8 : dy}px;--r:${r}deg;--s:${s};animation-delay:${d}s`}
        >
          <BurstShape kind={kind} />
        </i>
      ))}
    </span>
  );
}
