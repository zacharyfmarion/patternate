/**
 * Theme presets. Each entry defines a complete color palette.
 *
 * Porting the palettes from openscad-studio (apps/ui/src/themes/index.ts)
 * so the two apps stay visually consistent. We drop the Monaco editor
 * blocks since this app has no text editor.
 */

import type { Theme } from './types';

export const solarizedDark: Theme = {
  id: 'solarized-dark',
  name: 'Solarized Dark',
  category: 'Dark',
  type: 'dark',
  colors: {
    bg: { primary: '#002b36', secondary: '#073642', tertiary: '#0c4358', elevated: '#073642' },
    text: { primary: '#839496', secondary: '#93a1a1', tertiary: '#586e75', inverse: '#fdf6e3' },
    border: { primary: '#1a4f5e', secondary: '#586e75', focus: '#268bd2' },
    accent: { primary: '#268bd2', secondary: '#2aa198', hover: '#6c71c4' },
    semantic: { error: '#dc322f', warning: '#b58900', success: '#859900', info: '#268bd2' },
  },
};

export const solarizedLight: Theme = {
  id: 'solarized-light',
  name: 'Solarized Light',
  category: 'Light',
  type: 'light',
  colors: {
    bg: { primary: '#fdf6e3', secondary: '#eee8d5', tertiary: '#d0dad5', elevated: '#eee8d5' },
    text: { primary: '#657b83', secondary: '#586e75', tertiary: '#93a1a1', inverse: '#fdf6e3' },
    border: { primary: '#d9d2bc', secondary: '#93a1a1', focus: '#268bd2' },
    accent: { primary: '#268bd2', secondary: '#2aa198', hover: '#6c71c4' },
    semantic: { error: '#dc322f', warning: '#b58900', success: '#859900', info: '#268bd2' },
  },
};

export const monokai: Theme = {
  id: 'monokai',
  name: 'Monokai',
  category: 'Dark',
  type: 'dark',
  colors: {
    bg: { primary: '#272822', secondary: '#1e1f1c', tertiary: '#49483e', elevated: '#2e2e2e' },
    text: { primary: '#f8f8f2', secondary: '#cfcfc2', tertiary: '#75715e', inverse: '#272822' },
    border: { primary: '#49483e', secondary: '#75715e', focus: '#66d9ef' },
    accent: { primary: '#66d9ef', secondary: '#a6e22e', hover: '#ae81ff' },
    semantic: { error: '#f92672', warning: '#e6db74', success: '#a6e22e', info: '#66d9ef' },
  },
};

export const dracula: Theme = {
  id: 'dracula',
  name: 'Dracula',
  category: 'Dark',
  type: 'dark',
  colors: {
    bg: { primary: '#282a36', secondary: '#21222c', tertiary: '#44475a', elevated: '#343746' },
    text: { primary: '#f8f8f2', secondary: '#e6e6e6', tertiary: '#6272a4', inverse: '#282a36' },
    border: { primary: '#44475a', secondary: '#6272a4', focus: '#bd93f9' },
    accent: { primary: '#bd93f9', secondary: '#8be9fd', hover: '#ff79c6' },
    semantic: { error: '#ff5555', warning: '#f1fa8c', success: '#50fa7b', info: '#8be9fd' },
  },
};

export const oneDarkPro: Theme = {
  id: 'one-dark-pro',
  name: 'One Dark Pro',
  category: 'Dark',
  type: 'dark',
  colors: {
    bg: { primary: '#282c34', secondary: '#21252b', tertiary: '#3e4451', elevated: '#2c313c' },
    text: { primary: '#abb2bf', secondary: '#9da5b4', tertiary: '#5c6370', inverse: '#282c34' },
    border: { primary: '#3e4451', secondary: '#5c6370', focus: '#61afef' },
    accent: { primary: '#61afef', secondary: '#56b6c2', hover: '#c678dd' },
    semantic: { error: '#e06c75', warning: '#e5c07b', success: '#98c379', info: '#61afef' },
  },
};

export const githubDark: Theme = {
  id: 'github-dark',
  name: 'GitHub Dark',
  category: 'Dark',
  type: 'dark',
  colors: {
    bg: { primary: '#0d1117', secondary: '#161b22', tertiary: '#21262d', elevated: '#1c2128' },
    text: { primary: '#c9d1d9', secondary: '#8b949e', tertiary: '#6e7681', inverse: '#0d1117' },
    border: { primary: '#30363d', secondary: '#21262d', focus: '#58a6ff' },
    accent: { primary: '#58a6ff', secondary: '#56d364', hover: '#79c0ff' },
    semantic: { error: '#f85149', warning: '#d29922', success: '#56d364', info: '#58a6ff' },
  },
};

export const githubLight: Theme = {
  id: 'github-light',
  name: 'GitHub Light',
  category: 'Light',
  type: 'light',
  colors: {
    bg: { primary: '#ffffff', secondary: '#f6f8fa', tertiary: '#eaeef2', elevated: '#f6f8fa' },
    text: { primary: '#24292f', secondary: '#57606a', tertiary: '#6e7781', inverse: '#ffffff' },
    border: { primary: '#d0d7de', secondary: '#afb8c1', focus: '#0969da' },
    accent: { primary: '#0969da', secondary: '#1a7f37', hover: '#0550ae' },
    semantic: { error: '#cf222e', warning: '#9a6700', success: '#1a7f37', info: '#0969da' },
  },
};

export const nord: Theme = {
  id: 'nord',
  name: 'Nord',
  category: 'Cool',
  type: 'dark',
  colors: {
    bg: { primary: '#2e3440', secondary: '#3b4252', tertiary: '#434c5e', elevated: '#3b4252' },
    text: { primary: '#d8dee9', secondary: '#e5e9f0', tertiary: '#4c566a', inverse: '#2e3440' },
    border: { primary: '#3b4252', secondary: '#4c566a', focus: '#88c0d0' },
    accent: { primary: '#88c0d0', secondary: '#81a1c1', hover: '#5e81ac' },
    semantic: { error: '#bf616a', warning: '#ebcb8b', success: '#a3be8c', info: '#88c0d0' },
  },
};

export const tokyoNight: Theme = {
  id: 'tokyo-night',
  name: 'Tokyo Night',
  category: 'Dark',
  type: 'dark',
  colors: {
    bg: { primary: '#1a1b26', secondary: '#16161e', tertiary: '#414868', elevated: '#24283b' },
    text: { primary: '#c0caf5', secondary: '#a9b1d6', tertiary: '#565f89', inverse: '#1a1b26' },
    border: { primary: '#292e42', secondary: '#414868', focus: '#7aa2f7' },
    accent: { primary: '#7aa2f7', secondary: '#73daca', hover: '#bb9af7' },
    semantic: { error: '#f7768e', warning: '#e0af68', success: '#9ece6a', info: '#7aa2f7' },
  },
};

export const gruvboxDark: Theme = {
  id: 'gruvbox-dark',
  name: 'Gruvbox Dark',
  category: 'Warm',
  type: 'dark',
  colors: {
    bg: { primary: '#282828', secondary: '#1d2021', tertiary: '#504945', elevated: '#3c3836' },
    text: { primary: '#ebdbb2', secondary: '#d5c4a1', tertiary: '#928374', inverse: '#282828' },
    border: { primary: '#3c3836', secondary: '#504945', focus: '#83a598' },
    accent: { primary: '#83a598', secondary: '#8ec07c', hover: '#d3869b' },
    semantic: { error: '#fb4934', warning: '#fabd2f', success: '#b8bb26', info: '#83a598' },
  },
};

export const gruvboxLight: Theme = {
  id: 'gruvbox-light',
  name: 'Gruvbox Light',
  category: 'Light',
  type: 'light',
  colors: {
    bg: { primary: '#fbf1c7', secondary: '#f2e5bc', tertiary: '#d5c4a1', elevated: '#ebdbb2' },
    text: { primary: '#3c3836', secondary: '#504945', tertiary: '#928374', inverse: '#fbf1c7' },
    border: { primary: '#d5c4a1', secondary: '#bdae93', focus: '#076678' },
    accent: { primary: '#076678', secondary: '#427b58', hover: '#8f3f71' },
    semantic: { error: '#cc241d', warning: '#d79921', success: '#79740e', info: '#076678' },
  },
};

export const catppuccinMocha: Theme = {
  id: 'catppuccin-mocha',
  name: 'Catppuccin Mocha',
  category: 'Warm',
  type: 'dark',
  colors: {
    bg: { primary: '#1e1e2e', secondary: '#181825', tertiary: '#313244', elevated: '#1e1e2e' },
    text: { primary: '#cdd6f4', secondary: '#bac2de', tertiary: '#6c7086', inverse: '#1e1e2e' },
    border: { primary: '#313244', secondary: '#45475a', focus: '#89b4fa' },
    accent: { primary: '#89b4fa', secondary: '#94e2d5', hover: '#cba6f7' },
    semantic: { error: '#f38ba8', warning: '#f9e2af', success: '#a6e3a1', info: '#89b4fa' },
  },
};

export const ayuDark: Theme = {
  id: 'ayu-dark',
  name: 'Ayu Dark',
  category: 'Cool',
  type: 'dark',
  colors: {
    bg: { primary: '#0a0e14', secondary: '#01060e', tertiary: '#273747', elevated: '#11151c' },
    text: { primary: '#b3b1ad', secondary: '#8a8986', tertiary: '#4d5566', inverse: '#0a0e14' },
    border: { primary: '#0d1016', secondary: '#273747', focus: '#59c2ff' },
    accent: { primary: '#59c2ff', secondary: '#95e6cb', hover: '#ffae57' },
    semantic: { error: '#f07178', warning: '#ffb454', success: '#aad94c', info: '#59c2ff' },
  },
};

export const materialPalenight: Theme = {
  id: 'material-palenight',
  name: 'Material Palenight',
  category: 'Cool',
  type: 'dark',
  colors: {
    bg: { primary: '#292d3e', secondary: '#232635', tertiary: '#3a3f58', elevated: '#292d3e' },
    text: { primary: '#a6accd', secondary: '#959dcb', tertiary: '#676e95', inverse: '#292d3e' },
    border: { primary: '#3a3f58', secondary: '#676e95', focus: '#82aaff' },
    accent: { primary: '#82aaff', secondary: '#89ddff', hover: '#c792ea' },
    semantic: { error: '#ff5370', warning: '#ffcb6b', success: '#c3e88d', info: '#82aaff' },
  },
};

export const nightOwl: Theme = {
  id: 'night-owl',
  name: 'Night Owl',
  category: 'Cool',
  type: 'dark',
  colors: {
    bg: { primary: '#011627', secondary: '#01111d', tertiary: '#0b2942', elevated: '#011627' },
    text: { primary: '#d6deeb', secondary: '#c5e4fd', tertiary: '#5f7e97', inverse: '#011627' },
    border: { primary: '#0b2942', secondary: '#5f7e97', focus: '#82aaff' },
    accent: { primary: '#82aaff', secondary: '#7fdbca', hover: '#c792ea' },
    semantic: { error: '#ef5350', warning: '#ffeb95', success: '#addb67', info: '#82aaff' },
  },
};

export const synthwave: Theme = {
  id: 'synthwave-84',
  name: "Synthwave '84",
  category: 'Vibrant',
  type: 'dark',
  colors: {
    bg: { primary: '#262335', secondary: '#1e1c2a', tertiary: '#463465', elevated: '#2a2139' },
    text: { primary: '#dfd9e2', secondary: '#e4dfe7', tertiary: '#796686', inverse: '#262335' },
    border: { primary: '#463465', secondary: '#796686', focus: '#f97e72' },
    accent: { primary: '#f97e72', secondary: '#72f1b8', hover: '#fede5d' },
    semantic: { error: '#fe4450', warning: '#fede5d', success: '#72f1b8', info: '#36f9f6' },
  },
};

export const rosePine: Theme = {
  id: 'rose-pine',
  name: 'Rosé Pine',
  category: 'Warm',
  type: 'dark',
  colors: {
    bg: { primary: '#191724', secondary: '#1f1d2e', tertiary: '#403d52', elevated: '#26233a' },
    text: { primary: '#e0def4', secondary: '#908caa', tertiary: '#6e6a86', inverse: '#191724' },
    border: { primary: '#26233a', secondary: '#403d52', focus: '#9ccfd8' },
    accent: { primary: '#9ccfd8', secondary: '#31748f', hover: '#ebbcba' },
    semantic: { error: '#eb6f92', warning: '#f6c177', success: '#9ccfd8', info: '#31748f' },
  },
};

export const everforestDark: Theme = {
  id: 'everforest-dark',
  name: 'Everforest Dark',
  category: 'Cool',
  type: 'dark',
  colors: {
    bg: { primary: '#2b3339', secondary: '#232a2e', tertiary: '#3d484d', elevated: '#323c41' },
    text: { primary: '#d3c6aa', secondary: '#a7c080', tertiary: '#7a8478', inverse: '#2b3339' },
    border: { primary: '#3d484d', secondary: '#7a8478', focus: '#a7c080' },
    accent: { primary: '#a7c080', secondary: '#83c092', hover: '#dbbc7f' },
    semantic: { error: '#e67e80', warning: '#dbbc7f', success: '#a7c080', info: '#7fbbb3' },
  },
};

export const atomOneLight: Theme = {
  id: 'atom-one-light',
  name: 'Atom One Light',
  category: 'Light',
  type: 'light',
  colors: {
    bg: { primary: '#fafafa', secondary: '#f0f0f0', tertiary: '#d7dae0', elevated: '#ffffff' },
    text: { primary: '#383a42', secondary: '#696c77', tertiary: '#a0a1a7', inverse: '#fafafa' },
    border: { primary: '#e5e5e6', secondary: '#d7dae0', focus: '#4078f2' },
    accent: { primary: '#4078f2', secondary: '#0184bc', hover: '#a626a4' },
    semantic: { error: '#e45649', warning: '#986801', success: '#50a14f', info: '#4078f2' },
  },
};

export const shadesOfPurple: Theme = {
  id: 'shades-of-purple',
  name: 'Shades of Purple',
  category: 'Vibrant',
  type: 'dark',
  colors: {
    bg: { primary: '#2d2b55', secondary: '#1e1e3f', tertiary: '#4d21fc', elevated: '#3b3869' },
    text: { primary: '#e3dfff', secondary: '#b362ff', tertiary: '#a599e9', inverse: '#2d2b55' },
    border: { primary: '#4d21fc', secondary: '#6943ff', focus: '#fad000' },
    accent: { primary: '#fad000', secondary: '#ff628c', hover: '#a599e9' },
    semantic: { error: '#ec3a37', warning: '#fad000', success: '#3ad900', info: '#00d8ff' },
  },
};

export const cobalt2: Theme = {
  id: 'cobalt2',
  name: 'Cobalt2',
  category: 'Vibrant',
  type: 'dark',
  colors: {
    bg: { primary: '#193549', secondary: '#0d3a58', tertiary: '#1f4662', elevated: '#234e6d' },
    text: { primary: '#ffffff', secondary: '#cdd3de', tertiary: '#adb7c2', inverse: '#193549' },
    border: { primary: '#1f4662', secondary: '#0d3a58', focus: '#ffc600' },
    accent: { primary: '#ffc600', secondary: '#0088ff', hover: '#ff9d00' },
    semantic: { error: '#ff0000', warning: '#ffc600', success: '#3ad900', info: '#0088ff' },
  },
};

export const horizon: Theme = {
  id: 'horizon',
  name: 'Horizon',
  category: 'Warm',
  type: 'dark',
  colors: {
    bg: { primary: '#1c1e26', secondary: '#16161c', tertiary: '#2e303e', elevated: '#232530' },
    text: { primary: '#e0e0e0', secondary: '#d5d8da', tertiary: '#6c6f93', inverse: '#1c1e26' },
    border: { primary: '#2e303e', secondary: '#6c6f93', focus: '#e95678' },
    accent: { primary: '#e95678', secondary: '#fab795', hover: '#f09383' },
    semantic: { error: '#e95678', warning: '#fab795', success: '#29d398', info: '#26bbd9' },
  },
};

// ---------------------------------------------------------------------------
// Registry + lookups
// ---------------------------------------------------------------------------

export const THEMES: Record<string, Theme> = {
  'solarized-dark': solarizedDark,
  'solarized-light': solarizedLight,
  monokai,
  dracula,
  'one-dark-pro': oneDarkPro,
  'github-dark': githubDark,
  'github-light': githubLight,
  nord,
  'tokyo-night': tokyoNight,
  'gruvbox-dark': gruvboxDark,
  'gruvbox-light': gruvboxLight,
  'catppuccin-mocha': catppuccinMocha,
  'ayu-dark': ayuDark,
  'material-palenight': materialPalenight,
  'night-owl': nightOwl,
  'synthwave-84': synthwave,
  'rose-pine': rosePine,
  'everforest-dark': everforestDark,
  'atom-one-light': atomOneLight,
  'shades-of-purple': shadesOfPurple,
  cobalt2,
  horizon,
};

export const DEFAULT_THEME = 'one-dark-pro';

export function getTheme(id: string): Theme {
  return THEMES[id] ?? THEMES[DEFAULT_THEME];
}

/** Ordered list of themes grouped by category (for the picker UI). */
export function getAvailableThemes(): Array<{
  category: string;
  themes: Array<{ id: string; name: string }>;
}> {
  const byCategory: Record<string, Array<{ id: string; name: string }>> = {};
  for (const t of Object.values(THEMES)) {
    (byCategory[t.category] ??= []).push({ id: t.id, name: t.name });
  }
  const order = ['Dark', 'Light', 'Warm', 'Cool', 'Vibrant'];
  return order
    .filter((c) => byCategory[c])
    .map((category) => ({
      category,
      themes: byCategory[category].sort((a, b) => a.name.localeCompare(b.name)),
    }));
}
