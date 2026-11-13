import { useEffect, useState } from "react";

export const LIGHT_COLORS = {
  canvas: "#FCFCFC",
  card: "#FFFFFF",
  text: "#11191C",
  muted: "#697176",
  line: "#EEEEF0",
  blue: "#C8E7FF",
  blueDark: "#1473C8",
  sky: "#EDF7FD",
  green: "#E3F3E8",
  lavender: "#F0EEFA",
  orange: "#FDF0DF",
  danger: "#991B1B",
  errorBg: "#FEF2F2",
  errorBorder: "#FECACA",
};

export const DARK_COLORS = {
  canvas: "#111216",
  card: "#1C1D22",
  text: "#F4F4F6",
  muted: "#A1A1AA",
  line: "#2C2D35",
  blue: "#1E3A5F",
  blueDark: "#60A5FA",
  sky: "#172536",
  green: "#163024",
  lavender: "#252136",
  orange: "#332617",
  danger: "#FECACA",
  errorBg: "#2D1216",
  errorBorder: "#7F1D1D",
};

const KEY = "openmuse_dark";
let dark = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) !== "false" : true;
const listeners = new Set<() => void>();

export function isDarkMode(): boolean {
  return dark;
}
export function activePalette() {
  return dark ? DARK_COLORS : LIGHT_COLORS;
}

export function setDarkMode(next: boolean, targetColors?: Record<string, string>) {
  dark = next;
  if (typeof localStorage !== "undefined") localStorage.setItem(KEY, String(next));
  if (targetColors) Object.assign(targetColors, activePalette());
  for (const fn of listeners) fn();
}

export function useThemeMode() {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return dark;
}

export function syncStyles(
  s: Record<string, Record<string, string | number>>,
  c: Record<string, string>,
) {
  if (s.text) s.text.color = c.text;
  if (s.muted) s.muted.color = c.muted;
  if (s.small) s.small.color = c.muted;
  if (s.label) s.label.color = c.muted;
  if (s.title) s.title.color = c.text;
  if (s.heading) s.heading.color = c.text;
  if (s.card) {
    s.card.backgroundColor = c.card;
    s.card.borderColor = c.line;
  }
  if (s.divider) s.divider.backgroundColor = c.line;
  if (s.listCard) {
    s.listCard.backgroundColor = c.card;
    s.listCard.borderColor = c.line;
  }
  if (s.card) {
    s.card.backgroundColor = c.card;
    s.card.borderColor = c.line;
  }
  if (s.error) {
    s.error.backgroundColor = c.errorBg;
    s.error.borderColor = c.errorBorder;
  }
  if (s.input) {
    s.input.borderColor = c.line;
    s.input.color = c.text;
    s.input.backgroundColor = c.card;
  }
}
