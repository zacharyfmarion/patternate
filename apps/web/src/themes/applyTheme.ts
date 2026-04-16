import type { Theme } from './types';

/**
 * Write the theme's colors onto `:root` as CSS custom properties.
 * We emit both the "grouped" variables (used by new code) and a set of
 * legacy flat aliases (`--bg-hover`, `--panel-bg`, …) that existing
 * components consume. Keeping both layers means we can evolve the naming
 * scheme gradually without a big-bang CSS rewrite.
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  const c = theme.colors;

  // Grouped names (new).
  root.style.setProperty('--bg-primary', c.bg.primary);
  root.style.setProperty('--bg-secondary', c.bg.secondary);
  root.style.setProperty('--bg-tertiary', c.bg.tertiary);
  root.style.setProperty('--bg-elevated', c.bg.elevated);

  root.style.setProperty('--text-primary', c.text.primary);
  root.style.setProperty('--text-secondary', c.text.secondary);
  root.style.setProperty('--text-tertiary', c.text.tertiary);
  root.style.setProperty('--text-inverse', c.text.inverse);

  root.style.setProperty('--border-primary', c.border.primary);
  root.style.setProperty('--border-secondary', c.border.secondary);
  root.style.setProperty('--border-focus', c.border.focus);
  root.style.setProperty(
    '--border-subtle',
    theme.type === 'light'
      ? 'rgba(0, 0, 0, 0.08)'
      : 'rgba(255, 255, 255, 0.06)',
  );

  root.style.setProperty('--accent-primary', c.accent.primary);
  root.style.setProperty('--accent-secondary', c.accent.secondary);
  root.style.setProperty('--accent-hover', c.accent.hover);

  root.style.setProperty('--color-error', c.semantic.error);
  root.style.setProperty('--color-warning', c.semantic.warning);
  root.style.setProperty('--color-success', c.semantic.success);
  root.style.setProperty('--color-info', c.semantic.info);

  // Legacy flat aliases (kept for existing CSS). Mapped by role:
  //   - Panels sit on bg.primary; toolbars/sections use bg.secondary.
  //   - Hover state lands on bg.tertiary; active on bg.elevated.
  //   - Inputs look distinct from panels -> bg.primary works in dark
  //     themes but we use bg.secondary here to avoid invisible borders
  //     on light themes.
  root.style.setProperty('--fg-primary', c.text.primary);
  root.style.setProperty('--fg-secondary', c.text.secondary);
  root.style.setProperty('--fg-muted', c.text.tertiary);
  root.style.setProperty('--border', c.border.primary);
  root.style.setProperty('--border-strong', c.border.secondary);
  root.style.setProperty('--accent', c.accent.primary);
  root.style.setProperty('--accent-fg', c.text.inverse);
  root.style.setProperty('--success', c.semantic.success);
  root.style.setProperty('--warning', c.semantic.warning);
  root.style.setProperty('--danger', c.semantic.error);
  root.style.setProperty(
    '--bg-input',
    theme.type === 'light' ? c.bg.primary : c.bg.secondary,
  );
  root.style.setProperty('--bg-hover', c.bg.tertiary);
  root.style.setProperty('--bg-active', c.bg.elevated);
  root.style.setProperty('--toolbar-bg', c.bg.secondary);
  root.style.setProperty('--panel-bg', c.bg.primary);
  root.style.setProperty('--panel-header-bg', c.bg.secondary);
  root.style.setProperty('--scrollbar', c.bg.tertiary);

  // Update the UA hint so native widgets (scrollbars, form controls) use
  // the right palette and SVGs inherit sane defaults.
  root.style.setProperty('color-scheme', theme.type);
  root.setAttribute('data-theme-type', theme.type);
  root.setAttribute('data-theme-name', theme.id);
}
