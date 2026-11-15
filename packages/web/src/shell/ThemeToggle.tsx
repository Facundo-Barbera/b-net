import { MoonIcon, MonitorIcon, SunIcon } from "../components/icons.tsx";
import { THEME_PREFS, type ThemePref } from "../lib/theme.ts";

const META: Record<ThemePref, { label: string; Icon: typeof SunIcon }> = {
  system: { label: "System theme", Icon: MonitorIcon },
  dark: { label: "Dark theme", Icon: MoonIcon },
  light: { label: "Light theme", Icon: SunIcon },
};

/** Three-way segmented control (system / dark / light). Buttons expose `aria-pressed`. */
export function ThemeToggle({ pref, onChange }: { pref: ThemePref; onChange: (p: ThemePref) => void }) {
  return (
    <div className="sh-theme" role="group" aria-label="Theme">
      {THEME_PREFS.map((p) => {
        const { label, Icon } = META[p];
        return (
          <button
            key={p}
            type="button"
            className="sh-theme__btn"
            aria-label={label}
            aria-pressed={pref === p}
            title={label}
            data-theme-pref={p}
            onClick={() => onChange(p)}
          >
            <Icon />
          </button>
        );
      })}
    </div>
  );
}
