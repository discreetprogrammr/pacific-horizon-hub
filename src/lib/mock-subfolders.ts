import { useSyncExternalStore } from "react";

export interface MockSubfolder {
  id: string;
  name: string;
  parentId: string | null; // null = root of the department folder
  createdAt: string;
  ownerEmail: string | null;
}

// In-memory mock store (frontend only, resets on reload).
const store: Record<string, MockSubfolder[]> = {};
// Renamed root (department) folders — mock overrides keyed by slug.
const rootNames: Record<string, string> = {};
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

export function useMockRootNames(): Record<string, string> {
  return useSyncExternalStore(
    subscribe,
    () => rootNames,
    () => rootNames,
  );
}

export function renameRootFolder(slug: string, name: string) {
  rootNames[slug] = name.trim();
  emit();
}

export function addMockSubfolder(
  folderSlug: string,
  name: string,
  parentId: string | null,
  ownerEmail: string | null = null,
) {
  const next: MockSubfolder = {
    id: crypto.randomUUID(),
    name: name.trim(),
    parentId,
    createdAt: new Date().toISOString(),
    ownerEmail,
  };
  store[folderSlug] = [...(store[folderSlug] ?? []), next];
  emit();
  return next;
}

export function renameMockSubfolder(
  folderSlug: string,
  id: string,
  name: string,
) {
  store[folderSlug] = (store[folderSlug] ?? []).map((f) =>
    f.id === id ? { ...f, name: name.trim() } : f,
  );
  emit();
}

/** Remove a sub-folder and every descendant beneath it. */
export function deleteMockSubfolder(folderSlug: string, id: string) {
  const all = store[folderSlug] ?? [];
  const doomed = new Set<string>([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of all) {
      if (f.parentId && doomed.has(f.parentId) && !doomed.has(f.id)) {
        doomed.add(f.id);
        changed = true;
      }
    }
  }
  store[folderSlug] = all.filter((f) => !doomed.has(f.id));
  emit();
}

/** Simulated RBAC: super admins can rename anything, owners can rename their own. */
export function canRenameFolder(
  profile: { email?: string | null; role?: string | null } | null,
  ownerEmail: string | null,
) {
  if (!profile) return false;
  if (profile.role === "super_admin") return true;
  return !!ownerEmail && ownerEmail === profile.email;
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
