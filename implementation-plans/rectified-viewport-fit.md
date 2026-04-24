# Rectified Viewport Fit

## Goal

Keep the full rectified image visible inside the workspace viewport after a successful run, and make curve editing prefer selection across the whole result area while reserving panning for an explicit `Shift` drag.

## Approach

- Replace the rectified result stack's width-biased sizing with a full-stage contain layout so the browser fits the image against both viewport dimensions.
- Align the SVG overlays with the same centered fit box as the rectified image.
- Make the edit overlay own the full rectified stage and add `Shift`-drag panning through the viewport's native scroll APIs.
- Add focused tests for the rectified stage rendering path and the new edit-pan interaction.

## Affected Areas

- `apps/web/src/panels/WorkspacePanel.tsx`
- `apps/web/src/panels/EditOverlay.tsx`
- `apps/web/src/styles/index.css`
- `apps/web/src/panels/WorkspacePanel.test.tsx`
- `apps/web/src/panels/EditOverlay.test.tsx`
- `apps/web/src/test/setup.ts`
- `package.json`
- `CONTRIBUTING.md`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.yarnrc.yml`

## Checklist

- [x] Update rectified viewport layout to fit the entire image and center overlays.
- [x] Change edit interactions so `Shift` drag pans and regular drag keeps selection behavior.
- [x] Add or update web tests for both regressions.
- [x] Run targeted web validation commands.
