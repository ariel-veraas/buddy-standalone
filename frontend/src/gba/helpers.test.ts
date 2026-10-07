import { describe, expect, it } from "vitest";
import { detectEvolution, typewriterStep, xpPercentage } from "./helpers";
import { gridToRects, STAGE_GRIDS } from "./sprites";
import { canPlaySound } from "./sound";

describe("verified growth presentation", () => {
  it("clamps XP to its real range", () => { expect(xpPercentage(10,20)).toBe(50); expect(xpPercentage(-2,20)).toBe(0); expect(xpPercentage(30,20)).toBe(100); });
  it("handles invalid XP denominators", () => { expect(xpPercentage(1,0)).toBe(0); expect(xpPercentage(NaN,10)).toBe(0); expect(xpPercentage(1,Infinity)).toBe(0); });
  it("advances typewriter in steps", () => { expect(typewriterStep(5,29,false)).toBe(0); expect(typewriterStep(5,60,false)).toBe(2); expect(typewriterStep(5,999,false)).toBe(5); expect(typewriterStep(5,-1,false)).toBe(0); });
  it("shows all text with reduced motion", () => { expect(typewriterStep(10,0,true)).toBe(10); });
  it("records the first stage without celebrating", () => { const values = new Map<string,string>(); const storage = { getItem: (key:string) => values.get(key) ?? null, setItem: (key:string,value:string) => { values.set(key,value); } }; expect(detectEvolution(1,"egg",storage)).toBeNull(); expect(detectEvolution(1,"cria",storage)).toBe("egg"); expect(detectEvolution(1,"cria",storage)).toBeNull(); expect(detectEvolution(2,"adulto",storage)).toBeNull(); expect(detectEvolution(1,"egg",storage)).toBeNull(); });
  it("works when localStorage is absent or blocked", () => { expect(detectEvolution(1,"cria")).toBeNull(); expect(detectEvolution(1,"cria", { getItem: () => { throw new Error("blocked"); }, setItem: () => {} })).toBeNull(); });
  it("ignores corrupted stages", () => { expect(detectEvolution(1,"adulto",{ getItem: () => "corrupt", setItem: () => {} })).toBeNull(); });
  it("turns a pixel grid into positioned rectangles", () => { expect(gridToRects([".IB", "W ."])).toEqual([{x:1,y:0,color:"I"},{x:2,y:0,color:"B"},{x:0,y:1,color:"W"}]); });
  it("has five distinct stage grids with a limited palette", () => { expect(new Set(Object.values(STAGE_GRIDS).map((grid) => JSON.stringify(grid))).size).toBe(5); for (const grid of Object.values(STAGE_GRIDS)) expect(new Set(grid.join("").replaceAll(".","")).size).toBeLessThanOrEqual(6); });
});
describe("8-bit sound guards", () => {
  it("requires both preference and gesture", () => { expect(canPlaySound(false,true,"level",100,0)).toBe(false); expect(canPlaySound(true,false,"evolution",100,0)).toBe(false); expect(canPlaySound(true,true,"error",100,0)).toBe(true); });
  it("throttles ticks without throttling jingles", () => { expect(canPlaySound(true,true,"tick",79,0)).toBe(false); expect(canPlaySound(true,true,"tick",80,0)).toBe(true); expect(canPlaySound(true,true,"level",1,0)).toBe(true); });
});
