import { useSyncExternalStore } from "react";
import type { PortalFile } from "@/lib/portal";

export type ClipboardAction = "cut" | "copy";

export interface ClipboardEntry {
  action: ClipboardAction;
  /** One entry for a single file cut/copy, several for a bulk copy from the file-list selection. */
  files: PortalFile[];
  sourceFolderId: string;
  sourceFolderName: string;
}

const STORAGE_KEY = "phc-portal-clipboard";

function readStored(): ClipboardEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as
      ClipboardEntry | (Omit<ClipboardEntry, "files"> & { file: PortalFile });
    // Normalizes a clipboard entry saved by an older build (single `file`
    // rather than `files`) so a leftover sessionStorage value across a
    // deploy doesn't crash instead of just being an already-stale clipboard.
    if ("file" in parsed) {
      const { file, ...rest } = parsed;
      return { ...rest, files: [file] };
    }
    return parsed;
  } catch {
    return null;
  }
}

// Survives full page reloads so a cut/copy is still pastable after navigation.
let clipboard: ClipboardEntry | null = readStored();
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  if (!hydrated) {
    hydrated = true;
    clipboard = readStored();
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    if (clipboard) {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(clipboard));
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* storage unavailable — in-memory state still works */
  }
}

export function setClipboard(entry: ClipboardEntry) {
  clipboard = entry;
  persist();
  emit();
}

export function clearClipboard() {
  clipboard = null;
  persist();
  emit();
}

export function getClipboard() {
  return clipboard;
}

export function useClipboard(): ClipboardEntry | null {
  return useSyncExternalStore(
    subscribe,
    () => clipboard,
    () => null,
  );
}
