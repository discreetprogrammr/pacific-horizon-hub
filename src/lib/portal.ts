import { supabase } from "@/integrations/supabase/client";
import {
  copyObjectToFolder,
  deleteObject,
  deleteObjects,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
  moveObjectToFolder,
  requestDownloadUrl,
  requestUploadUrl,
  restoreObjectToPath,
} from "@/lib/r2-storage";

export type AppRole = "super_admin" | "department_user";

export interface PortalProfile {
  id: string;
  email: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  department: string | null;
  role: AppRole;
}

export interface Folder {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  department: string;
  parent_id: string | null;
  owner_email: string | null;
  created_by: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
}

export interface PortalFile {
  id: string;
  folder_id: string;
  name: string;
  size: number;
  mime_type: string | null;
  storage_path: string;
  uploaded_by: string;
  created_at: string;
  uploader_email?: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
}

// Object storage lives in Cloudflare R2 (see src/server/r2-storage.ts), not
// Supabase Storage. The bucket name is a server-only env var; nothing here
// needs it — every upload/download/copy/move/delete goes through a
// permission-checked server function.

export async function fetchProfile(): Promise<PortalProfile | null> {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return null;

  // first_name/last_name may not exist yet on older databases — fall back gracefully.
  const withNames = await supabase
    .from("profiles")
    .select("id, email, full_name, department, first_name, last_name")
    .eq("id", user.id)
    .maybeSingle();

  const base = withNames.error
    ? await supabase
        .from("profiles")
        .select("id, email, full_name, department")
        .eq("id", user.id)
        .maybeSingle()
    : withNames;

  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);

  const profile = base.data as {
    email?: string | null;
    full_name?: string | null;
    department?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  } | null;

  const role: AppRole = (roles ?? []).some((r) => r.role === "super_admin")
    ? "super_admin"
    : "department_user";

  return {
    id: user.id,
    email: profile?.email ?? user.email ?? "",
    full_name: profile?.full_name ?? null,
    first_name: profile?.first_name ?? null,
    last_name: profile?.last_name ?? null,
    department: profile?.department ?? null,
    role,
  };
}

/** Full name for the header: First + Last, falling back to full_name / email. */
export function displayName(profile: PortalProfile) {
  const composed = [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim();
  return composed || profile.full_name || profile.email;
}

/** First name only, for the welcome banner. */
export function firstNameOf(profile: PortalProfile) {
  return (
    profile.first_name?.trim() ||
    profile.full_name?.trim().split(/\s+/)[0] ||
    profile.email.split("@")[0]
  );
}

const FOLDER_COLUMNS =
  "id, slug, name, description, department, parent_id, owner_email, created_by, deleted_at, deleted_by";

/** Every non-deleted folder the signed-in user may see, roots and sub-folders alike. */
export async function fetchAllFolders(): Promise<Folder[]> {
  const { data, error } = await supabase
    .from("folders")
    .select(FOLDER_COLUMNS)
    .is("deleted_at", null)
    .order("name");
  if (error) throw error;
  return (data ?? []) as Folder[];
}

/**
 * Every folder regardless of deletion state. Needed to walk a subtree
 * correctly when soft-deleting or restoring a folder — the filtered list
 * above hides deleted folders, which would otherwise make an
 * already-deleted parent's still-deleted children invisible to
 * subtreeIds() during a restore.
 */
export async function fetchAllFoldersIncludingDeleted(): Promise<Folder[]> {
  const { data, error } = await supabase.from("folders").select(FOLDER_COLUMNS).order("name");
  if (error) throw error;
  return (data ?? []) as Folder[];
}

/** Root (department) folders only — these are the dashboard cards. */
export async function fetchFolders(): Promise<Folder[]> {
  const all = await fetchAllFolders();
  return all.filter((f) => f.parent_id === null);
}

export async function fetchFolderBySlug(slug: string): Promise<Folder | null> {
  const { data, error } = await supabase
    .from("folders")
    .select(FOLDER_COLUMNS)
    .eq("slug", slug)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return (data as Folder | null) ?? null;
}

/** Folders currently in the recycle bin, most recently deleted first. */
export async function fetchDeletedFolders(): Promise<Folder[]> {
  const { data, error } = await supabase
    .from("folders")
    .select(FOLDER_COLUMNS)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Folder[];
}

/* ------------------------- hierarchy helpers ------------------------- */

export function childrenOf(all: Folder[], parentId: string | null) {
  return all.filter((f) => f.parent_id === parentId);
}

/** Trail of folders from the root's first child down to `id`. */
export function pathOf(all: Folder[], id: string | null): Folder[] {
  const trail: Folder[] = [];
  let current = all.find((f) => f.id === id);
  while (current && current.parent_id !== null) {
    trail.unshift(current);
    const parentId: string | null = current.parent_id;
    current = all.find((f) => f.id === parentId);
  }
  return trail;
}

/** Walks up the parent chain to the top-level (department) folder that owns `id`. */
export function rootAncestorOf(all: Folder[], id: string): Folder | null {
  let current = all.find((f) => f.id === id) ?? null;
  while (current && current.parent_id !== null) {
    current = all.find((f) => f.id === current!.parent_id) ?? null;
  }
  return current;
}

/** The folder itself plus every descendant beneath it. */
export function subtreeIds(all: Folder[], id: string): string[] {
  const ids = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of all) {
      if (f.parent_id && ids.has(f.parent_id) && !ids.has(f.id)) {
        ids.add(f.id);
        grew = true;
      }
    }
  }
  return [...ids];
}

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "folder"
  );
}

/** Create a persistent sub-folder inside `parent`. */
export async function createSubfolder(
  parent: Folder,
  name: string,
  profile: PortalProfile,
): Promise<Folder> {
  const trimmed = name.trim();
  const { data, error } = await supabase
    .from("folders")
    .insert({
      name: trimmed,
      slug: `${slugify(trimmed)}-${crypto.randomUUID().slice(0, 8)}`,
      description: null,
      department: parent.department,
      parent_id: parent.id,
      created_by: profile.id,
      owner_email: profile.email,
    })
    .select(FOLDER_COLUMNS)
    .single();
  if (error) throw error;
  return data as Folder;
}

export async function renameFolderRow(folder: Folder, name: string) {
  const { error } = await supabase
    .from("folders")
    .update({ name: name.trim() })
    .eq("id", folder.id);
  if (error) throw error;
}

/** Super admins rename anything; creators rename the folders they made. */
export function canRenameFolder(profile: PortalProfile | null, folder: Folder | null) {
  if (!profile || !folder) return false;
  if (profile.role === "super_admin") return true;
  return !!folder.owner_email && folder.owner_email === profile.email;
}

const FILE_COLUMNS =
  "id, folder_id, name, size, mime_type, storage_path, uploaded_by, created_at, deleted_at, deleted_by";

export async function fetchFiles(folderId: string): Promise<PortalFile[]> {
  const { data, error } = await supabase
    .from("files")
    .select(FILE_COLUMNS)
    .eq("folder_id", folderId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as PortalFile[];

  const uploaderIds = [...new Set(rows.map((r) => r.uploaded_by))];
  if (uploaderIds.length === 0) return rows;

  const { data: people } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .in("id", uploaderIds);

  const byId = new Map((people ?? []).map((p) => [p.id, p.full_name || p.email] as const));
  return rows.map((r) => ({ ...r, uploader_email: byId.get(r.uploaded_by) ?? "—" }));
}

function escapeLikePattern(value: string): string {
  // ILIKE treats %, _ and \ as pattern syntax — escape anything a user types
  // that happens to collide with it, so a search for "50%" or "invoice_v2"
  // matches literally instead of being read as a wildcard.
  return value.replace(/[%_\\]/g, (match) => `\\${match}`);
}

/**
 * Files whose name matches `query` (case-insensitive substring), across
 * every folder the signed-in user can see — not scoped to one folder_id, so
 * this relies entirely on the "Read permitted files" RLS policy to keep
 * results limited to what the caller is actually allowed to read.
 */
export async function searchFiles(query: string, limit = 8): Promise<PortalFile[]> {
  const q = query.trim();
  if (!q) return [];
  const { data, error } = await supabase
    .from("files")
    .select(FILE_COLUMNS)
    .ilike("name", `%${escapeLikePattern(q)}%`)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as PortalFile[];
}

/** Files currently in the recycle bin, most recently deleted first. */
export async function fetchDeletedFiles(): Promise<PortalFile[]> {
  const { data, error } = await supabase
    .from("files")
    .select(FILE_COLUMNS)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PortalFile[];
}

export async function fetchFolderCounts(folderIds: string[]) {
  if (folderIds.length === 0) return {} as Record<string, number>;
  const { data, error } = await supabase
    .from("files")
    .select("folder_id")
    .in("folder_id", folderIds)
    .is("deleted_at", null);
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    counts[row.folder_id] = (counts[row.folder_id] ?? 0) + 1;
  }
  return counts;
}

export function canWrite(profile: PortalProfile | null, folder: Folder | null) {
  if (!profile || !folder) return false;
  return profile.role === "super_admin" || profile.department === folder.department;
}

/** PUTs a file straight to R2 via a presigned URL, reporting real upload progress. */
function putWithProgress(
  url: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        // Reserve the tail of the bar for the DB insert that follows.
        onProgress?.(Math.round((event.loaded / event.total) * 80));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.send(file);
  });
}

export async function uploadFile(
  folder: Folder,
  file: File,
  userId: string,
  onProgress?: (pct: number) => void,
) {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `"${file.name}" is ${formatBytes(file.size)} — the maximum upload size is ${MAX_UPLOAD_LABEL}.`,
    );
  }

  onProgress?.(5);
  const { uploadUrl, storagePath } = await requestUploadUrl({
    data: {
      folderSlug: folder.slug,
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      fileSize: file.size,
    },
  });

  await putWithProgress(uploadUrl, file, onProgress);

  onProgress?.(90);
  const { data: inserted, error: insertError } = await supabase
    .from("files")
    .insert({
      folder_id: folder.id,
      name: file.name,
      size: file.size,
      mime_type: file.type || null,
      storage_path: storagePath,
      uploaded_by: userId,
    })
    .select("id")
    .single();
  if (insertError) {
    await deleteObject({ data: { storagePath } }).catch(() => {
      // best-effort cleanup; a stray object with no DB row is harmless
    });
    throw insertError;
  }
  onProgress?.(100);
  return inserted?.id ?? null;
}

/**
 * Replaces an existing file's content in place — same row/id, new storage
 * object — for the "Replace" choice in the upload name-conflict dialog.
 * Uploads to a fresh storage path first and only swaps the row over once
 * that succeeds, so a failed upload never touches the original; the old
 * object is removed only after the row points at the new one.
 */
export async function replaceFile(
  existing: PortalFile,
  folder: Folder,
  file: File,
  userId: string,
  onProgress?: (pct: number) => void,
) {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `"${file.name}" is ${formatBytes(file.size)} — the maximum upload size is ${MAX_UPLOAD_LABEL}.`,
    );
  }

  onProgress?.(5);
  const { uploadUrl, storagePath } = await requestUploadUrl({
    data: {
      folderSlug: folder.slug,
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      fileSize: file.size,
    },
  });

  await putWithProgress(uploadUrl, file, onProgress);

  onProgress?.(90);
  const oldStoragePath = existing.storage_path;
  const { error: updateError } = await supabase
    .from("files")
    .update({
      name: file.name,
      size: file.size,
      mime_type: file.type || null,
      storage_path: storagePath,
      uploaded_by: userId,
      created_at: new Date().toISOString(),
    })
    .eq("id", existing.id);
  if (updateError) {
    // The new object is already written but the row swap failed — clean it
    // up so it doesn't linger with no file row behind it. The original file
    // and its object are untouched.
    await deleteObject({ data: { storagePath } }).catch(() => {});
    throw updateError;
  }

  await deleteObject({ data: { storagePath: oldStoragePath } }).catch(() => {
    // best-effort cleanup; the row already points at the new object, so a
    // stray old one is harmless
  });
  onProgress?.(100);
}

/**
 * Finds the next "name (1).ext", "name (2).ext", ... that isn't already
 * taken, for the "Keep Both" choice in the upload name-conflict dialog.
 * `existingNamesLower` must already be lower-cased, matching how names are
 * compared for conflicts elsewhere.
 */
export function nextAvailableName(name: string, existingNamesLower: Set<string>): string {
  if (!existingNamesLower.has(name.toLowerCase())) return name;
  const dotIndex = name.lastIndexOf(".");
  const hasExt = dotIndex > 0 && dotIndex < name.length - 1;
  const base = hasExt ? name.slice(0, dotIndex) : name;
  const ext = hasExt ? name.slice(dotIndex) : "";
  let counter = 1;
  let candidate = `${base} (${counter})${ext}`;
  while (existingNamesLower.has(candidate.toLowerCase())) {
    counter += 1;
    candidate = `${base} (${counter})${ext}`;
  }
  return candidate;
}

export async function downloadFile(file: PortalFile) {
  const { url } = await requestDownloadUrl({
    data: { storagePath: file.storage_path, fileName: file.name, mode: "download" },
  });
  window.open(url, "_blank", "noopener");
}

export interface BulkResult<T = PortalFile> {
  succeeded: number;
  failed: T[];
}

/**
 * Downloads several files one after another for the bulk file-list action.
 * Deliberately does NOT reuse downloadFile's window.open — firing several
 * window.open calls in a row gets the later ones silently blocked by the
 * browser's pop-up blocker. A same-tab anchor click isn't treated as a
 * pop-up (the server response already sets Content-Disposition: attachment,
 * so it downloads instead of navigating away), and a short pause between
 * files keeps the browser's download manager from racing them.
 */
export async function downloadFiles(files: PortalFile[]): Promise<BulkResult> {
  const failed: PortalFile[] = [];
  let succeeded = 0;
  for (const file of files) {
    try {
      const { url } = await requestDownloadUrl({
        data: { storagePath: file.storage_path, fileName: file.name, mode: "download" },
      });
      const link = document.createElement("a");
      link.href = url;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      succeeded += 1;
    } catch {
      failed.push(file);
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return { succeeded, failed };
}

/** Short-lived signed URL used to render a file inline in the preview modal. */
export async function createPreviewUrl(file: PortalFile): Promise<string> {
  const { url } = await requestDownloadUrl({
    data: { storagePath: file.storage_path, mode: "preview" },
  });
  return url;
}

/** Moves a file to the recycle bin. Reversible — see restoreFile. */
export async function softDeleteFile(file: PortalFile, userId: string) {
  const { error } = await supabase
    .from("files")
    .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
    .eq("id", file.id);
  if (error) throw error;
}

/** Moves several files to the recycle bin at once, for the bulk file-list action. */
export async function softDeleteFiles(files: PortalFile[], userId: string): Promise<BulkResult> {
  const results = await Promise.allSettled(files.map((file) => softDeleteFile(file, userId)));
  const failed = files.filter((_, index) => results[index]?.status === "rejected");
  return { succeeded: files.length - failed.length, failed };
}

/** Restores a file out of the recycle bin. */
export async function restoreFile(file: PortalFile) {
  const { error } = await supabase
    .from("files")
    .update({ deleted_at: null, deleted_by: null })
    .eq("id", file.id);
  if (error) throw error;
}

/**
 * Moves a folder and everything beneath it — sub-folders and files alike —
 * to the recycle bin. `all` must include already-deleted folders
 * (fetchAllFoldersIncludingDeleted) so a folder that's already partly in
 * the trash is still walked correctly. Reversible — see restoreFolder.
 */
export async function softDeleteFolder(folder: Folder, all: Folder[], userId: string) {
  const ids = all.length ? subtreeIds(all, folder.id) : [folder.id];
  const now = new Date().toISOString();

  const { error: foldersError } = await supabase
    .from("folders")
    .update({ deleted_at: now, deleted_by: userId })
    .in("id", ids);
  if (foldersError) throw foldersError;

  const { error: filesError } = await supabase
    .from("files")
    .update({ deleted_at: now, deleted_by: userId })
    .in("folder_id", ids);
  if (filesError) throw filesError;
}

/**
 * Restores a folder and its whole subtree out of the recycle bin, along
 * with every file inside it — including files that were deleted on their
 * own, before the folder was. `all` should come from
 * fetchAllFoldersIncludingDeleted so the subtree walk sees deleted folders too.
 */
export async function restoreFolder(folder: Folder, all: Folder[]) {
  const ids = all.length ? subtreeIds(all, folder.id) : [folder.id];

  const { error: foldersError } = await supabase
    .from("folders")
    .update({ deleted_at: null, deleted_by: null })
    .in("id", ids);
  if (foldersError) throw foldersError;

  const { error: filesError } = await supabase
    .from("files")
    .update({ deleted_at: null, deleted_by: null })
    .in("folder_id", ids);
  if (filesError) throw filesError;
}

/** Permanently deletes a file — the "Delete forever" action in the recycle bin. */
export async function deleteFile(file: PortalFile) {
  const { error } = await supabase.from("files").delete().eq("id", file.id);
  if (error) throw error;
  await deleteObject({ data: { storagePath: file.storage_path } });
}

/**
 * Permanently deletes a folder and everything beneath it — the
 * "Delete forever" action in the recycle bin. Sub-folder rows and file
 * metadata cascade away in the database; stored objects are removed here.
 */
export async function deleteFolder(folder: Folder, all: Folder[] = []) {
  const ids = all.length ? subtreeIds(all, folder.id) : [folder.id];

  const { data: rows, error: listError } = await supabase
    .from("files")
    .select("storage_path")
    .in("folder_id", ids);
  if (listError) throw listError;

  const { error: deleteError } = await supabase.from("folders").delete().eq("id", folder.id);
  if (deleteError) throw deleteError;

  const paths = (rows ?? []).map((r) => r.storage_path);
  if (paths.length) await deleteObjects({ data: { storagePaths: paths } });
}

/**
 * Permanently deletes several files at once, for the "Delete selected"
 * action in the recycle bin. Sequential — each one is a storage delete plus
 * a DB delete, so this keeps R2 requests from piling up concurrently.
 */
export async function deleteFiles(files: PortalFile[]): Promise<BulkResult<PortalFile>> {
  const failed: PortalFile[] = [];
  let succeeded = 0;
  for (const file of files) {
    try {
      await deleteFile(file);
      succeeded += 1;
    } catch {
      failed.push(file);
    }
  }
  return { succeeded, failed };
}

/**
 * Permanently deletes several folders (and everything under each) at once.
 * Sequential, same reasoning as deleteFiles — also sidesteps any ordering
 * risk from selecting both a folder and one of its already-deleted
 * children: whichever purges first removes the other's rows too, and the
 * second call is then just a harmless no-op.
 */
export async function deleteFolders(
  folders: Folder[],
  all: Folder[] = [],
): Promise<BulkResult<Folder>> {
  const failed: Folder[] = [];
  let succeeded = 0;
  for (const folder of folders) {
    try {
      await deleteFolder(folder, all);
      succeeded += 1;
    } catch {
      failed.push(folder);
    }
  }
  return { succeeded, failed };
}

/** Duplicate a file's storage object and metadata row into another folder. */
export async function copyFileToFolder(file: PortalFile, target: Folder, userId: string) {
  const { storagePath } = await copyObjectToFolder({
    data: {
      sourcePath: file.storage_path,
      destFolderSlug: target.slug,
      fileName: file.name,
    },
  });

  const { data: inserted, error: insertError } = await supabase
    .from("files")
    .insert({
      folder_id: target.id,
      name: file.name,
      size: file.size,
      mime_type: file.mime_type,
      storage_path: storagePath,
      uploaded_by: userId,
    })
    .select("id")
    .single();
  if (insertError) {
    await deleteObject({ data: { storagePath } }).catch(() => {
      // best-effort cleanup; a stray object with no DB row is harmless
    });
    throw insertError;
  }
  return inserted?.id as string | undefined;
}

/** Move a file's storage object and update its folder reference. */
export async function moveFileToFolder(file: PortalFile, target: Folder) {
  if (file.folder_id === target.id) return;
  const { storagePath } = await moveObjectToFolder({
    data: {
      sourcePath: file.storage_path,
      destFolderSlug: target.slug,
      fileName: file.name,
    },
  });

  const { error: updateError } = await supabase
    .from("files")
    .update({ folder_id: target.id, storage_path: storagePath })
    .eq("id", file.id);
  if (updateError) {
    // Roll the object back to its exact original key so it matches the
    // `files` row, which was never updated since this write is what failed.
    await restoreObjectToPath({
      data: { currentPath: storagePath, restorePath: file.storage_path },
    }).catch(() => {
      // best-effort rollback; a briefly orphaned object is recoverable manually
    });
    throw updateError;
  }
}

/**
 * Copies several files into a folder at once, for pasting a multi-file
 * clipboard selection. Sequential, like downloadFiles — each copy already
 * does a storage write plus a DB insert, so running them one at a time
 * avoids piling up concurrent R2 requests for what's normally an
 * occasional, human-paced action.
 */
export async function copyFilesToFolder(
  files: PortalFile[],
  target: Folder,
  userId: string,
): Promise<BulkResult> {
  const failed: PortalFile[] = [];
  let succeeded = 0;
  for (const file of files) {
    try {
      await copyFileToFolder(file, target, userId);
      succeeded += 1;
    } catch {
      failed.push(file);
    }
  }
  return { succeeded, failed };
}

/** Moves several files into a folder at once, for pasting a cut multi-file selection. */
export async function moveFilesToFolder(files: PortalFile[], target: Folder): Promise<BulkResult> {
  const failed: PortalFile[] = [];
  let succeeded = 0;
  for (const file of files) {
    try {
      await moveFileToFolder(file, target);
      succeeded += 1;
    } catch {
      failed.push(file);
    }
  }
  return { succeeded, failed };
}

export function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function initialsOf(profile: PortalProfile) {
  const source = displayName(profile);
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}
