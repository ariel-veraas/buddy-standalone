import { COLORS, SPECIES, type Species } from "../buddy/species";
import { STAGE_NAMES, type Stage } from "./helpers";

export const STAGE_GRIDS: Record<Stage, string[]> = {
  egg: ["....IIII....", "...IBBBBI...", "..IBBBBBBI..", ".IBBWBBBBBI.", ".IBWWBBBBBI.", "IBBBBBABBBBI", "IBBBBABABBBI", "IBBBBBABBBBI", "IBBSBBBBBBBI", ".IBSSSSBBBI.", "..IIIIIIII.."],
  cria: ["...IIIIII...", "..IBBBBBBI..", ".IBBWBBBBBI.", "IBBWBBBBBBBI", "IBBIBBBIBBBI", "IBBIBBBIBBBI", "IABBBIBBBBAI", ".IBBBBBBBBI.", "..ISSSSSSI..", "..II....II.."],
  joven: ["....IIIIIIII....", "..IIBBBBBBBBII..", ".IBBBWBBBBBBBBI.", "IBBBWWBBBBBBBBBI", "IBBBBBBBBBBBBBBI", "IBBBIBBBBBIBBBBI", "IBBBIBBBBBIBBBBI", "IBABBBBIBBBBABBI", ".IBBBBBBBBBBBBI.", "..IBBBBBBBBBBI..", "..IBSSSSSSSSBI..", "...III....III..."],
  adulto: ["....IIIIIIII....", "..IIBBBBBBBBII..", ".IBBBBWWBBBBBBI.", "IBBBBWWBBBBBBBBI", "IBBBBBBBBBBBBBBI", "IBBBIBBBBBIBBBBI", "IBBBIBBBBBIBBBBI", "IBABBBBIBBBBABBI", "IBBBBBBBBBBBBBBI", ".IBBBBBBBBBBBBI.", ".IBBBBBBBBBBBBI.", "..IBSSSSSSSSBI..", "..III......III.."],
  legendario: ["....IIIIIIII....", "..IIBBBBBBBBII..", ".IBBBBWWBBBBBBI.", "IBBBBWWBBBBBBBBI", "IBBBBBBBBBBBBBBI", "IBBBIBBBBBIBBBBI", "IBBBIBBBBBIBBBBI", "IBABBBBIBBBBABBI", "IBBBBBBBBBBBBBBI", "IBBBBBBBBBBBBBBI", ".IBBBBBBBBBBBBI.", ".IBBBBBBBBBBBBI.", "..IBSSSSSSSSBI..", "..III......III.."],
};
const PARTS: Record<Species, string[]> = {
  mochi: ["..AA....AA..", "...AA..AA...", "....AAAA....", ".....II....."],
  kitsu: ["I..........I", "IBI......IBI", "IBBI....IBBI", "IBABI..IBABI"],
  neko: [".I........I.", ".IBI....IBI.", ".IBAI..IABI."],
  nube: ["..III..III..", ".IBBBIIBBBI.", "IBBBBBBBBBBI"],
  conejo: [".II......II.", ".IBI....IBI.", ".IAI....IAI.", ".IAI....IAI.", ".IBI....IBI."],
  osito: [".III....III.", "IBABI..IBABI", ".III....III."],
};
export function gridToRects(grid: string[]) {
  return grid.flatMap((row, y) => Array.from(row).flatMap((color, x) => color === "." || color === " " ? [] : [{ x, y, color }]));
}
export function PixelBuddy({ stage, species = "mochi", color = "", size = 144, idle = true, silhouette = false }: { stage: Stage; species?: Species; color?: string; size?: number; idle?: boolean; silhouette?: boolean }) {
  const selected = COLORS.find((c) => c.id === (color || SPECIES.find((s) => s.id === species)?.defaultColor)) ?? COLORS[0];
  const palette: Record<string, string> = { I: "#2b2233", B: selected.body, S: selected.shade, A: selected.accent, W: "#ffffff", G: "#e2b83c" };
  const grid = STAGE_GRIDS[stage], x = (32 - grid[0].length) / 2, y = 28 - grid.length;
  const renderGrid = (rows: string[], dx: number, dy: number) => gridToRects(rows).map((p) => <rect key={`${dx}:${dy}:${p.x}:${p.y}`} x={p.x + dx} y={p.y + dy} width="1" height="1" fill={silhouette ? "currentColor" : palette[p.color]} />);
  return <svg class={`gba-sprite ${idle ? "gba-idle" : ""}`} viewBox="0 0 32 32" width={size} height={size} shape-rendering="crispEdges" role="img" aria-label={silhouette ? "Tema por descubrir" : `Buddy ${STAGE_NAMES[stage].toLowerCase()}`}>
    {stage !== "egg" && renderGrid(PARTS[species], 10, y - PARTS[species].length + 1)}
    {stage !== "egg" && (species === "kitsu" || species === "neko") && renderGrid(["..II", ".IBI", "IBBI", "IBSI", ".II."], 24, 20)}
    {renderGrid(grid, x, y)}
    {stage === "legendario" && renderGrid(["G..G..G", "GGGGGGG", ".GGGGG."], 12, y - 3)}
    {stage === "legendario" && renderGrid([".G.", "GGG", ".G."], 3, 10)}
  </svg>;
}
