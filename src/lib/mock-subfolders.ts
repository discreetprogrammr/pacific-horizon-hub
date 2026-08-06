import { useSyncExternalStore } from "react";

export interface MockSubfolder {
  id: string;
  name: string;
  parentId: string | null; // null = root of the department folder
  createdAt: string;
}

// In-memory mock store (frontend only, resets on reload).
const store: Record<string, MockSubfolder[]> = {};
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const EMPTY: MockSubfolder[] = [];

export function useMockSubfolders(folderSlug: string): MockSubfolder[] {
  return useSyncExternalStore(
    subscribe,
    () => store[folderSlug] ?? EMPTY,
    () => EMPTY,
  );
}

export function addMockSubfolder(
  folderSlug: string,
  name: string,
  parentId: string | null,
) {
  const next: MockSubfolder = {
    id: crypto.randomUUID(),
    name: name.trim(),
    parentId,
    createdAt: new Date().toISOString(),
  };
  store[folderSlug] = [...(store[folderSlug] ?? []), next];
  emit();
  return next;
}

export function childrenOf(all: MockSubfolder[], parentId: string | null) {
  return all.filter((f) => f.parentId === parentId);
}

export function pathOf(all: MockSubfolder[], id: string | null): MockSubfolder[] {
  const trail: MockSubfolder[] = [];
  let current = all.find((f) => f.id === id);
  while (current) {
    trail.unshift(current);
    const parentId: string | null = current.parentId;
    current = parentId ? all.find((f) => f.id === parentId) : undefined;
  }
  return trail;
}
