import { useSyncExternalStore } from "react";
import type { PortalFile } from "@/lib/portal";

export type ClipboardAction = "cut" | "copy";

export interface ClipboardEntry {
  action: ClipboardAction;
  file: PortalFile;
  sourceFolderId: string;
  sourceFolderName: string;
}

let clipboard: ClipboardEntry | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setClipboard(entry: ClipboardEntry) {
  clipboard = entry;
  emit();
}

export function clearClipboard() {
  clipboard = null;
  emit();
}

export function useClipboard(): ClipboardEntry | null {
  return useSyncExternalStore(
    subscribe,
    () => clipboard,
    () => null,
  );
}
