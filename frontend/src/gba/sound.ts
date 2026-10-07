export type SoundKind = "tick" | "level" | "evolution" | "error";
export function canPlaySound(enabled: boolean, unlocked: boolean, kind: SoundKind, now: number, lastTick: number) {
  return enabled && unlocked && (kind !== "tick" || now - lastTick >= 80);
}
let enabled = false, unlocked = false, lastTick = -Infinity;
let context: AudioContext | undefined;
export function configureSound(value: boolean) { enabled = value; }
export function unlockSound() {
  unlocked = true;
  if (!enabled) return;
  try { context ??= new AudioContext(); void context.resume().catch(() => {}); } catch { /* Audio no disponible. */ }
}
export function playSound(kind: SoundKind) {
  const now = performance.now();
  if (!canPlaySound(enabled, unlocked, kind, now, lastTick) || !context || context.state !== "running") return;
  if (kind === "tick") lastTick = now;
  const notes = kind === "tick" ? [700] : kind === "error" ? [220, 165] : kind === "level" ? [523, 659, 784] : [392, 523, 659, 784, 1047];
  notes.forEach((frequency, i) => {
    const at = context!.currentTime + i * .11, duration = kind === "tick" ? .016 : .09;
    const oscillator = context!.createOscillator(), gain = context!.createGain();
    oscillator.type = "square";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(.018, at);
    gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
    oscillator.connect(gain); gain.connect(context!.destination);
    oscillator.start(at); oscillator.stop(at + duration);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  });
}
