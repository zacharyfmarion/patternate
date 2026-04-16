import { getTheme } from '../themes/presets';

/**
 * Grid of themed cards. Each card shows the theme name plus a six-strip
 * preview made of bg, accent, text, secondary, error, success colors so
 * the user can eyeball the palette at a glance.
 */

interface ThemeSection {
  category: string;
  themes: Array<{ id: string; name: string }>;
}

interface ThemePickerProps {
  sections: ThemeSection[];
  value: string;
  onChange: (id: string) => void;
}

export function ThemePicker({ sections, value, onChange }: ThemePickerProps) {
  return (
    <div className="pd-theme-picker">
      {sections.map((section) => (
        <div key={section.category} className="pd-theme-picker__section">
          <div className="pd-theme-picker__category">{section.category}</div>
          <div className="pd-theme-picker__grid">
            {section.themes.map((t) => {
              const theme = getTheme(t.id);
              const selected = value === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onChange(t.id)}
                  className="pd-theme-card"
                  data-selected={selected ? 'true' : 'false'}
                  aria-pressed={selected}
                  title={t.name}
                >
                  <span className="pd-theme-card__name">{t.name}</span>
                  <div className="pd-theme-card__swatches">
                    <span
                      className="pd-theme-card__swatch"
                      style={{ background: theme.colors.bg.primary }}
                    />
                    <span
                      className="pd-theme-card__swatch"
                      style={{ background: theme.colors.bg.secondary }}
                    />
                    <span
                      className="pd-theme-card__swatch"
                      style={{ background: theme.colors.text.primary }}
                    />
                    <span
                      className="pd-theme-card__swatch"
                      style={{ background: theme.colors.accent.primary }}
                    />
                    <span
                      className="pd-theme-card__swatch"
                      style={{ background: theme.colors.semantic.success }}
                    />
                    <span
                      className="pd-theme-card__swatch"
                      style={{ background: theme.colors.semantic.error }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
