# Simplify defaults, slider range, and tab close buttons

## Goal

Raise the default simplify tolerance to 2 mm, extend the slider max to 10 mm, and remove
the close (×) buttons from Dockview pane tabs.

## Approach

- `settingsStore.ts`: bump `simplifyMm` default from 0.3 → 2.
- `InspectorPanel.tsx`: raise slider `max` from 3 → 10.
- `SettingsModal.tsx`: raise number input `max` from 5 → 10 for consistency.
- `index.css`: add a scoped CSS rule to hide `.dv-default-tab-action` (the Dockview close
  button element) within the `dockview-theme-pattern-detector` theme class.

## Affected Areas

- `apps/web/src/store/settingsStore.ts`
- `apps/web/src/panels/InspectorPanel.tsx`
- `apps/web/src/components/SettingsModal.tsx`
- `apps/web/src/styles/index.css`

## Checklist

- [ ] Default `simplifyMm` set to 2 in `settingsStore.ts`
- [ ] Inspector slider `max` raised to 10
- [ ] SettingsModal input `max` raised to 10
- [ ] Dockview tab close buttons hidden via CSS
- [ ] Web validation passes (`yarn lint`, `yarn workspace web build`)
- [ ] PR opened
