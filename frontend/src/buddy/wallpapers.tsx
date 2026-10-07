import type { JSX } from "preact";
import "./wallpapers.css";

export const WALLPAPERS: { id: string; name: string }[] = [
  { id: "liso", name: "Liso" },
  { id: "corazones", name: "Corazones" },
  { id: "estrellas", name: "Estrellas" },
  { id: "nubes", name: "Nubes" },
  { id: "flores", name: "Flores" },
  { id: "patitas", name: "Patitas" },
  { id: "sakura", name: "Sakura" },
  { id: "lunas", name: "Lunas" },
  { id: "ondas", name: "Ondas" },
  { id: "puntitos", name: "Puntitos" },
  { id: "garabatos", name: "Garabatos" },
];

const TILE = 200;
// Hand-jittered positions (x, y, rotation, scale) so the tile does not read as a grid.
const SLOTS: [number, number, number, number][] = [
  [26, 30, -18, 1.0], [96, 18, 12, 0.8], [158, 40, 24, 1.15],
  [60, 78, 30, 0.9], [126, 90, -10, 1.0], [184, 120, 16, 0.75],
  [20, 128, 8, 1.1], [82, 148, -26, 0.85], [142, 164, 20, 1.2],
  [44, 186, 14, 0.7], [108, 120, -34, 0.65],
];

type Motif = () => JSX.Element;
const F = "currentColor";

const heart: Motif = () => <path d="M0 8 C-13 -1 -9 -11 0 -4.5 C9 -11 13 -1 0 8Z" fill={F} />;
const sparkle: Motif = () => <path d="M0-10 Q1.2-1.2 10 0 Q1.2 1.2 0 10 Q-1.2 1.2 -10 0 Q-1.2-1.2 0-10Z" fill={F} />;
const star: Motif = () => (
  <path d="M0-10 L2.9-3.4 L10-3 L4.6 1.6 L6.2 8.6 L0 4.9 L-6.2 8.6 L-4.6 1.6 L-10-3 L-2.9-3.4Z" fill={F} strokeLinejoin="round" stroke={F} strokeWidth="1.2" />
);
const cloud: Motif = () => (
  <path d="M-11 5 A4.5 4.5 0 0 1 -9 -3.6 A6 6 0 0 1 2 -6 A5.5 5.5 0 0 1 10 -0.5 A3.6 3.6 0 0 1 9 5Z" fill={F} />
);
const flower: Motif = () => (
  <g fill={F}>
    {[0, 72, 144, 216, 288].map((a) => (
      <circle key={a} cx="0" cy="-5.5" r="4" transform={`rotate(${a})`} />
    ))}
    <circle r="2.4" style="fill: var(--wp-bg)" />
  </g>
);
const paw: Motif = () => (
  <g fill={F}>
    <path d="M0 0.5 C-5.5 0.5 -7.5 6 -4.5 8 C-2.5 9.3 -1.5 8 0 8 C1.5 8 2.5 9.3 4.5 8 C7.5 6 5.5 0.5 0 0.5Z" />
    <ellipse cx="-7" cy="-2.5" rx="2.2" ry="3" transform="rotate(-20 -7 -2.5)" />
    <ellipse cx="-2.6" cy="-6.4" rx="2.2" ry="3.1" transform="rotate(-6 -2.6 -6.4)" />
    <ellipse cx="2.6" cy="-6.4" rx="2.2" ry="3.1" transform="rotate(6 2.6 -6.4)" />
    <ellipse cx="7" cy="-2.5" rx="2.2" ry="3" transform="rotate(20 7 -2.5)" />
  </g>
);
const blossom: Motif = () => (
  <g fill={F}>
    {[0, 72, 144, 216, 288].map((a) => (
      <path key={a} d="M0 0 C-5.5 -3.5 -5 -10.5 -1.4 -10.6 L0 -8.6 L1.4 -10.6 C5 -10.5 5.5 -3.5 0 0Z" transform={`rotate(${a})`} />
    ))}
  </g>
);
const moon: Motif = () => <path d="M3 -10 A10 10 0 1 0 10 5 A8 8 0 0 1 3 -10Z" fill={F} />;
const tinyStar: Motif = () => <path d="M0-5 Q.6-.6 5 0 Q.6 .6 0 5 Q-.6 .6 -5 0 Q-.6-.6 0-5Z" fill={F} />;
const wave: Motif = () => (
  <path d="M-13 0 q3.25 -6 6.5 0 t6.5 0 t6.5 0 t6.5 0" fill="none" stroke={F} strokeWidth="2.4" strokeLinecap="round" />
);
const ring: Motif = () => <circle r="5.5" fill="none" stroke={F} strokeWidth="2.2" />;
const dot: Motif = () => <circle r="4.5" fill={F} />;
const dotSm: Motif = () => <circle r="2.4" fill={F} />;
const dotBig: Motif = () => <circle r="7" fill={F} />;
const squiggle: Motif = () => (
  <path d="M-11 3 C-8 -8 -4 -8 -2 0 S4 8 7 -2 S11 -4 12 0" fill="none" stroke={F} strokeWidth="2.2" strokeLinecap="round" />
);
const zigzag: Motif = () => (
  <path d="M-11 4 L-6 -4 L-1 4 L4 -4 L9 4" fill="none" stroke={F} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
);
const cross: Motif = () => (
  <path d="M-6 0 H6 M0 -6 V6" fill="none" stroke={F} strokeWidth="2.2" strokeLinecap="round" />
);
const spiral: Motif = () => (
  <path d="M0 0 C2 -2 4 0 3 3 C1 6 -4 5 -5 0 C-6 -6 1 -9 6 -6" fill="none" stroke={F} strokeWidth="2" strokeLinecap="round" />
);
const heartLine: Motif = () => (
  <path d="M0 7 C-11 -1 -8 -9 0 -4 C8 -9 11 -1 0 7Z" fill="none" stroke={F} strokeWidth="2" strokeLinejoin="round" />
);

const SETS: Record<string, Motif[]> = {
  corazones: [heart, heartLine, heart, heart, heartLine],
  estrellas: [star, sparkle, tinyStar, star, sparkle, tinyStar],
  nubes: [cloud, cloud, dotSm, cloud],
  flores: [flower, dotSm, flower, flower],
  patitas: [paw, paw, dotSm, paw],
  sakura: [blossom, blossom, dotSm, blossom],
  lunas: [moon, tinyStar, moon, sparkle, tinyStar],
  ondas: [wave, wave, ring, wave, dotSm],
  puntitos: [dot, dotSm, dotBig, dotSm, dot],
  garabatos: [squiggle, zigzag, cross, spiral, ring, squiggle, cross],
};

let uid = 0;

export function Wallpaper({ id }: { id: string }) {
  const motifs = SETS[id];
  if (!motifs) return null;
  const pid = `wp-${id}-${++uid}`;
  // Offset the motif assignment per wallpaper so layouts differ between themes.
  const shift = id.length % motifs.length;
  return (
    <svg
      class="wp-svg"
      aria-hidden="true"
      focusable="false"
      width="100%"
      height="100%"
      style="position:absolute;inset:0;display:block;pointer-events:none"
    >
      <defs>
        <pattern id={pid} width={TILE} height={TILE} patternUnits="userSpaceOnUse">
          {SLOTS.map(([x, y, r, s], i) => {
            const M = motifs[(i + shift) % motifs.length];
            return (
              <g key={i} transform={`translate(${x} ${y}) rotate(${r}) scale(${s})`}>
                <M />
              </g>
            );
          })}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${pid})`} />
    </svg>
  );
}
