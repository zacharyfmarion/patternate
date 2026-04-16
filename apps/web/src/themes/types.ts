/**
 * Theme tokens. Every UI color comes from this typed map; no hex literals
 * in components. Applied at runtime by writing `--token` CSS variables onto
 * `document.documentElement`.
 *
 * Structure mirrors the grouped model from openscad-studio (bg/text/border/
 * accent/semantic) for authoring clarity, but we also expose a flat set of
 * semantic aliases (bgHover, panelBg, scrollbar, …) that the existing CSS
 * already consumes.
 */

export type ThemeCategory = 'Dark' | 'Light' | 'Warm' | 'Cool' | 'Vibrant';

export interface ThemeColors {
  bg: {
    primary: string;    // app background
    secondary: string;  // panels, toolbars
    tertiary: string;   // hover tints, strong borders
    elevated: string;   // dropdowns, active states
  };
  text: {
    primary: string;
    secondary: string;
    tertiary: string;
    inverse: string; // text on accent fills
  };
  border: {
    primary: string;
    secondary: string;
    focus: string;
  };
  accent: {
    primary: string;
    secondary: string;
    hover: string;
  };
  semantic: {
    error: string;
    warning: string;
    success: string;
    info: string;
  };
}

export interface Theme {
  id: string;
  name: string;
  category: ThemeCategory;
  type: 'dark' | 'light';
  colors: ThemeColors;
}
