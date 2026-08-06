import { useSyncExternalStore } from "react";
import type { PortalFile } from "@/lib/portal";

export type ClipboardAction = "cut" | "copy";

export interface ClipboardEntry {
  action: ClipboardAction;
  file: PortalFile;
  sourceFolderId: string;
  sourceFolderName: string;
}

const STORAGE_KEY = "phc-portal-clipboard";

function readStored(): ClipboardEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ClipboardEntry) : null;
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
