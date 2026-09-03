import { useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "phtek-portal-theme";

function readStored(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    // localStorage unavailable (private browsing, disabled storage, etc.)
    return "system";
  }
}

function prefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(theme: Theme) {
  const isDark = theme === "dark" || (theme === "system" && prefersDark());
  document.documentElement.classList.toggle("dark", isDark);
}

/**
 * Light/dark/system theme preference, persisted per-browser in localStorage
 * and mirrored onto the `dark` class on <html>. A blocking inline script in
 * the document head (see __root.tsx's RootShell) applies the stored
 * preference before first paint, so there's no flash of the wrong theme on
 * load — this hook keeps things in sync afterwards: when the user picks a
 * new option here, and live if the OS-level preference changes while
 * "System" is selected. Only ever rendered inside the authenticated layout,
 * which is client-only (ssr: false), so reading localStorage synchronously
 * in the initializer here is safe — there's no server-rendered markup for
 * this component to mismatch against.
 */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(() => readStored());

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme(theme);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [theme]);

  function setTheme(next: Theme) {
    setThemeState(next);
    try {
      if (next === "system") window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // best-effort persistence; the in-memory state above still works
    }
  }

  return [theme, setTheme];
}
