export type Species = "mochi" | "kitsu" | "neko" | "nube" | "conejo" | "osito";

export type Mood =
  | "neutral"
  | "happy"
  | "thinking"
  | "doubt"
  | "love"
  | "sleepy"
  | "surprised"
  | "dizzy"
  | "sad"
  | "wave";

export type Accessory = "bow" | "hat" | "glasses" | "crown";

export const SPECIES: { id: Species; name: string; blurb: string; defaultColor: string }[] = [
  { id: "mochi", name: "Mochi", blurb: "Una bolita de arroz con una hojita en la cabeza.", defaultColor: "nieve" },
  { id: "kitsu", name: "Kitsu", blurb: "Un zorrito curioso con cola esponjosa.", defaultColor: "durazno" },
  { id: "neko", name: "Neko", blurb: "Un gatito tranquilo que ronronea cuando aprendés algo.", defaultColor: "lila" },
  { id: "nube", name: "Nube", blurb: "Una nubecita flotante, suave y soñadora.", defaultColor: "cielo" },
  { id: "conejo", name: "Conejo", blurb: "Orejas largas y mucha energía.", defaultColor: "rosa" },
  { id: "osito", name: "Osito", blurb: "Un osito abrazable y leal.", defaultColor: "cacao" },
];

export const COLORS: { id: string; name: string; body: string; shade: string; accent: string }[] = [
  { id: "nieve", name: "Nieve", body: "#fbfdff", shade: "#bfd2e6", accent: "#ffa9c2" },
  { id: "rosa", name: "Rosa", body: "#ffc4d8", shade: "#f08bb0", accent: "#ff7aa2" },
  { id: "durazno", name: "Durazno", body: "#ffcfa6", shade: "#ef9d6c", accent: "#ff8a7a" },
  { id: "manteca", name: "Manteca", body: "#ffe9a2", shade: "#e9c25a", accent: "#ffa56b" },
  { id: "menta", name: "Menta", body: "#b8f0d2", shade: "#6cc9a0", accent: "#ff9fb5" },
  { id: "cielo", name: "Cielo", body: "#b9e0ff", shade: "#6ea8e6", accent: "#ff9fc0" },
  { id: "lila", name: "Lila", body: "#dac8ff", shade: "#a68ce0", accent: "#ff9ccf" },
  { id: "cacao", name: "Cacao", body: "#c99d7c", shade: "#8d6048", accent: "#ff9a8a" },
];

export const ACCESSORIES: { id: Accessory; name: string; unlockAt: number }[] = [
  { id: "bow", name: "Moñito", unlockAt: 5 },
  { id: "hat", name: "Gorrito de fiesta", unlockAt: 20 },
  { id: "glasses", name: "Anteojos", unlockAt: 50 },
  { id: "crown", name: "Corona", unlockAt: 100 },
];

export const MOODS: Mood[] = [
  "neutral",
  "happy",
  "thinking",
  "doubt",
  "love",
  "sleepy",
  "surprised",
  "dizzy",
  "sad",
  "wave",
];
