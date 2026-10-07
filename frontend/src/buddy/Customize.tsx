import { Modal } from "../ui";
import { Buddy } from "./Buddy";
import { ACCESSORIES, type Species } from "./species";
import { TINTS, bondLevel, type Prefs } from "./personality";
import { WALLPAPERS, Wallpaper } from "./wallpapers";

type Props = {
  cfg: { buddy_name: string; species: Species; color: string; default_wallpaper: string };
  prefs: Prefs;
  onChange: (change: Partial<Prefs>) => void;
  onClose: () => void;
};

/** Lo que cada persona elige para sí: fondo del chat, color de sus burbujas y accesorio de su Buddy. */
export function Customize({ cfg, prefs, onChange, onClose }: Props) {
  const wallpaper = prefs.wallpaper || cfg.default_wallpaper;
  const bond = bondLevel(prefs.asked);
  return (
    <Modal title={`Personalizá tu chat con ${cfg.buddy_name}`} onClose={onClose} actions={<button class="btn primary" onClick={onClose}>Listo</button>}>
      <section class="stack custom" aria-labelledby="c-wp">
        <h3>Tu modo de juego</h3>
        <label class="check"><input type="checkbox" checked={prefs.gba} onChange={(e) => onChange({ gba: e.currentTarget.checked })} />Modo GBA</label>
        <label class="check"><input type="checkbox" checked={prefs.sound} onChange={(e) => onChange({ sound: e.currentTarget.checked })} />Sonidos 8-bit</label>
        <p class="faint">Buddy crece con mejoras verificadas de la empresa. Preguntar suma cariño, pero no XP.</p>
        <h3 id="c-wp">Fondo del chat</h3>
        <div class="wp-grid" role="radiogroup" aria-labelledby="c-wp">
          {WALLPAPERS.map((w) => (
            <button key={w.id} type="button" role="radio" aria-checked={wallpaper === w.id} class="wp-swatch" onClick={() => onChange({ wallpaper: w.id })}>
              <span class="wp swatch-art" data-wp={w.id}><Wallpaper id={w.id} /></span>
              <span>{w.name}</span>
            </button>
          ))}
        </div>
      </section>
      <section class="stack custom" aria-labelledby="c-tint">
        <h3 id="c-tint">Color de tus mensajes</h3>
        <div class="tints" role="radiogroup" aria-labelledby="c-tint">
          {TINTS.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={prefs.tint === t.id} aria-label={t.name} title={t.name} class="tint"
              style={{ "--sw-l": t.light, "--sw-d": t.dark }} onClick={() => onChange({ tint: t.id })} />
          ))}
        </div>
      </section>
      <section class="stack custom" aria-labelledby="c-acc">
        <h3 id="c-acc">Accesorios</h3>
        <p class="faint">Cada respuesta que recibís le suma cariño a {cfg.buddy_name}. Con el cariño se desbloquean accesorios nuevos. {prefs.asked === 0 ? "Preguntale algo para empezar a sumar cariño." : `Llevás ${prefs.asked}${bond.next ? ` de ${bond.next} para el próximo` : ""}.`}</p>
        <div class="acc-grid" role="radiogroup" aria-labelledby="c-acc">
          <button type="button" role="radio" aria-checked={!prefs.accessory} class="acc" onClick={() => onChange({ accessory: "" })}>
            <Buddy species={cfg.species} color={cfg.color} mood="neutral" size={64} label="" idle={false} /><span>Ninguno</span>
          </button>
          {ACCESSORIES.map((a) => {
            const locked = prefs.asked < a.unlockAt;
            return (
              <button key={a.id} type="button" role="radio" aria-checked={prefs.accessory === a.id} disabled={locked} class={`acc ${locked ? "locked" : ""}`} onClick={() => onChange({ accessory: a.id })}>
                <Buddy species={cfg.species} color={cfg.color} mood={locked ? "sleepy" : "happy"} accessory={locked ? "" : a.id} size={64} label="" idle={false} />
                <span>{a.name}</span>
                {locked && <small>a las {a.unlockAt} respuestas</small>}
              </button>
            );
          })}
        </div>
      </section>
    </Modal>
  );
}
