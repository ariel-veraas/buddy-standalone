import { useState } from "preact/hooks";
import { Field } from "../ui";
import { Buddy } from "./Buddy";
import { COLORS, MOODS, SPECIES, type Mood, type Species } from "./species";
import { WALLPAPERS, Wallpaper } from "./wallpapers";
import { line } from "./personality";

const TONES: [string, string, string][] = [
  ["calido", "Cálido", "Cercano, con algún emoji suave."],
  ["profesional", "Profesional", "Sobrio y sin emojis."],
  ["divertido", "Divertido", "Juguetón, con humor liviano."],
];
const MOOD_NAMES: Record<Mood, string> = {
  neutral: "Tranquilo", happy: "Contento", thinking: "Pensando", doubt: "Con dudas", love: "Enamorado", sleepy: "Dormido",
  surprised: "Sorprendido", dizzy: "Mareado", sad: "Triste", wave: "Saludando",
};

type Props = { form: Record<string, any>; set: (key: string, value: string) => void };

/** Cómo es el Buddy de la empresa: personaje, color, tono y fondo por defecto, con vista previa viva. */
export function PersonalityPicker({ form, set }: Props) {
  const [mood, setMood] = useState<Mood>("happy");
  const species = (form.buddy_species || "mochi") as Species;
  const info = SPECIES.find((s) => s.id === species) ?? SPECIES[0];
  const color = form.buddy_color || info.defaultColor;
  return (
    <section class="stack" aria-labelledby="s-pers">
      <h2 id="s-pers">Personalidad</h2>
      <p class="muted">Elegí quién da la cara por tu empresa. La gente lo ve en el chat, en el ingreso y en la barra lateral.</p>

      <div class="pers-preview wp" data-wp={form.default_wallpaper || "corazones"}>
        <Wallpaper id={form.default_wallpaper || "corazones"} />
        <Buddy species={species} color={color} mood={mood} size={150} label={form.buddy_name || "Buddy"} />
        <div class="bubble bot"><p class="answer">{line(species, "greet", { name: "Sol", hour: 10 })}</p></div>
      </div>
      <div class="chips" role="group" aria-label="Probar estados de ánimo">
        {MOODS.map((m) => <button type="button" key={m} class="chip" aria-pressed={mood === m} onClick={() => setMood(m)}>{MOOD_NAMES[m]}</button>)}
      </div>

      <h3 id="p-sp">Personaje</h3>
      <div class="acc-grid" role="radiogroup" aria-labelledby="p-sp">
        {SPECIES.map((s) => (
          <button type="button" key={s.id} role="radio" aria-checked={species === s.id} class="acc" onClick={() => { set("buddy_species", s.id); set("buddy_color", ""); }}>
            <Buddy species={s.id} color={s.defaultColor} mood="happy" size={72} label="" /><span>{s.name}</span>
          </button>
        ))}
      </div>
      <p class="faint">{info.blurb}</p>

      <h3 id="p-co">Color</h3>
      <div class="tints" role="radiogroup" aria-labelledby="p-co">
        {COLORS.map((c) => (
          <button type="button" key={c.id} role="radio" aria-checked={color === c.id} aria-label={c.name} title={c.name} class="tint"
            style={{ "--sw-l": c.body, "--sw-d": c.shade }} onClick={() => set("buddy_color", c.id === info.defaultColor ? "" : c.id)} />
        ))}
      </div>

      <div class="fields">
        <Field label="Tono de voz" id="tone" hint={TONES.find((t) => t[0] === (form.buddy_tone || "calido"))?.[2]}>
          <select id="tone" class="input" value={form.buddy_tone || "calido"} onChange={(e) => set("buddy_tone", (e.target as HTMLSelectElement).value)}>
            {TONES.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </Field>
        <Field label="Fondo del chat por defecto" id="wpdef" hint="Cada persona puede elegir el suyo desde el chat.">
          <select id="wpdef" class="input" value={form.default_wallpaper || "corazones"} onChange={(e) => set("default_wallpaper", (e.target as HTMLSelectElement).value)}>
            {WALLPAPERS.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </Field>
      </div>
    </section>
  );
}
