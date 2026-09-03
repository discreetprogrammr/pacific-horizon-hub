import { useState } from "react";

export type ViewMode = "grid" | "list";

const STORAGE_KEY = "phtek-portal-view-mode";
const DEFAULT_VIEW: ViewMode = "grid";

function readStored(): ViewMode {
  if (typeof window === "undefined") return DEFAULT_VIEW;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "list" ? "list" : DEFAULT_VIEW;
  } catch {
    // localStorage unavailable (private browsing, disabled storage, etc.)
    return DEFAULT_VIEW;
  }
}

/**
 * Shared grid/list view preference for folder and file listings. Persisted
 * per-browser in localStorage under one key so a choice made on the
 * dashboard carries over into the folder browser, and across visits. The
 * whole authenticated app renders client-only (ssr: false on that route
 * layout), so reading localStorage synchronously in the initializer here
 * is safe — there's no server-rendered markup it could mismatch against.
 */
export function useViewMode(): [ViewMode, (mode: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(() => readStored());

  function update(next: ViewMode) {
    setMode(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // best-effort persistence; the in-memory state above still works
    }
  }

  return [mode, update];
}
