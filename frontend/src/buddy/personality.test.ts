import { describe, expect, it } from "vitest";
import {
  ACCESSORY_UNLOCKS, DEFAULT_PREFS, SPECIES, TINTS, allLines, bondLevel, line, moodForExpression,
  newlyUnlocked, streakMessage, todayLocal, touchStreak, unlockedAccessories, type LineKind,
} from "./personality";

const KINDS: LineKind[] = ["greet", "idle", "thinking", "answered", "doubt", "thanks", "sorry", "poke", "dizzy", "sleepy", "wake", "levelUp", "typing"];

function lum(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe("content", () => {
  it("every species has >=4 lines of every kind", () => {
    for (const s of SPECIES) for (const k of KINDS) expect(allLines(s, k).length, `${s}/${k}`).toBeGreaterThanOrEqual(4);
  });
  it("line never repeats ctx.last", () => {
    for (const s of SPECIES) for (const k of KINDS) {
      let last = line(s, k, { name: "Ana", hour: 10, n: 1 });
      for (let i = 0; i < 30; i++) {
        const next = line(s, k, { name: "Ana", hour: 10, n: 1, last });
        expect(next).not.toBe(last);
        last = next;
      }
    }
  });
  it("greet uses the name and varies by hour; no leftover tokens without name", () => {
    expect(line("mochi", "greet", { name: "Ana", hour: 9 }, () => 0)).toContain("Ana");
    for (const s of SPECIES) for (const k of KINDS) {
      expect(line(s, k, { hour: 9, accessory: "hat" }, () => 0.99)).not.toMatch(/\{|undefined/);
    }
    expect(line("kitsu", "greet", { hour: 9 }, () => 0)).not.toBe(line("kitsu", "greet", { hour: 23 }, () => 0));
  });
  it("poke escalates with n", () => {
    expect(line("osito", "poke", { n: 1 }, () => 0)).not.toBe(line("osito", "poke", { n: 7 }, () => 0));
  });
  it("levelUp mentions the accessory", () => {
    expect(line("conejo", "levelUp", { accessory: "crown" }, () => 0)).toContain("corona");
  });
  it("mood mapping", () => {
    expect(moodForExpression("wink")).toBe("happy");
    expect(moodForExpression("doubt")).toBe("doubt");
    expect(moodForExpression("???")).toBe("neutral");
  });
});

describe("bond", () => {
  it("unlocks", () => {
    expect(unlockedAccessories(4)).toEqual([]);
    expect(unlockedAccessories(20)).toEqual(["bow", "hat"]);
    expect(unlockedAccessories(100)).toHaveLength(4);
    expect(newlyUnlocked(4, 5)).toEqual(["bow"]);
    expect(newlyUnlocked(0, 100)).toHaveLength(4);
    expect(newlyUnlocked(5, 6)).toEqual([]);
    expect(ACCESSORY_UNLOCKS.crown).toBe(100);
  });
  it("levels", () => {
    expect(bondLevel(0)).toEqual({ level: 0, next: 5, progress: 0 });
    expect(bondLevel(5).level).toBe(1);
    expect(bondLevel(12).progress).toBeCloseTo(7 / 15);
    expect(bondLevel(500)).toEqual({ level: 4, next: null, progress: 1 });
  });
});

describe("streak", () => {
  const p = (streak: number, last_day: string) => ({ ...DEFAULT_PREFS, streak, last_day });
  it("first time starts at 1", () => expect(touchStreak(DEFAULT_PREFS, "2026-10-07").streak).toBe(1));
  it("same day unchanged", () => {
    const x = p(4, "2026-10-07");
    expect(touchStreak(x, "2026-10-07")).toEqual(x);
  });
  it("yesterday and day before count", () => {
    expect(touchStreak(p(4, "2026-10-06"), "2026-10-07").streak).toBe(5);
    expect(touchStreak(p(4, "2026-10-05"), "2026-10-07").streak).toBe(5);
  });
  it("longer gap resets to 1, month boundary works", () => {
    expect(touchStreak(p(9, "2026-10-03"), "2026-10-07").streak).toBe(1);
    expect(touchStreak(p(3, "2026-09-30"), "2026-10-01").streak).toBe(4);
  });
  it("todayLocal formats", () => expect(todayLocal(new Date(2026, 0, 5))).toBe("2026-01-05"));
  it("messages only on milestones", () => {
    for (const n of [1, 2, 4, 5, 8, 29, 31]) expect(streakMessage(n)).toBeNull();
    for (const n of [3, 7, 14, 30, 60]) expect(streakMessage(n)).toBeTruthy();
  });
});

describe("tints", () => {
  it("ids and AA contrast", () => {
    expect(TINTS.map((t) => t.id)).toEqual(["azul", "rosa", "menta", "durazno", "lila", "limon"]);
    for (const t of TINTS) {
      expect(ratio(t.light, t.ink), t.id).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t.dark, t.inkDark), t.id).toBeGreaterThanOrEqual(4.5);
    }
  });
});
