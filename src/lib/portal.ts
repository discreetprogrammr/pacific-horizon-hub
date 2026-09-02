import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  copyObjectToFolder,
  deleteObject,
  deleteObjects,
  moveObjectToFolder,
  requestDownloadUrl,
  requestUploadUrl,
  restoreObjectToPath,
} from "@/lib/r2-storage";

/**
 * Folder rows carry columns (parent_id, owner_email, created_by) that the
 * generated types do not know about yet, so folder queries go through a
 * loosely typed view of the same client.
 */
const db = supabase as unknown as SupabaseClient;

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
  "id, slug, name, description, department, parent_id, owner_email, created_by";

/** Every folder the signed-in user may see, roots and sub-folders alike. */
export async function fetchAllFolders(): Promise<Folder[]> {
  const { data, error } = await db.from("folders").select(FOLDER_COLUMNS).order("name");
  if (error) throw error;
  return (data ?? []) as Folder[];
}

/** Root (department) folders only — these are the dashboard cards. */
export async function fetchFolders(): Promise<Folder[]> {
  const all = await fetchAllFolders();
  return all.filter((f) => f.parent_id === null);
}

export async function fetchFolderBySlug(slug: string): Promise<Folder | null> {
  const { data, error } = await db
    .from("folders")
    .select(FOLDER_COLUMNS)
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return (data as Folder | null) ?? null;
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
  const { data, error } = await db
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
  const { error } = await db.from("folders").update({ name: name.trim() }).eq("id", folder.id);
  if (error) throw error;
}

/** Super admins rename anything; creators rename the folders they made. */
export function canRenameFolder(profile: PortalProfile | null, folder: Folder | null) {
  if (!profile || !folder) return false;
  if (profile.role === "super_admin") return true;
  return !!folder.owner_email && folder.owner_email === profile.email;
}

export async function fetchFiles(folderId: string): Promise<PortalFile[]> {
  const { data, error } = await supabase
    .from("files")
    .select("id, folder_id, name, size, mime_type, storage_path, uploaded_by, created_at")
    .eq("folder_id", folderId)
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

export async function fetchFolderCounts(folderIds: string[]) {
  if (folderIds.length === 0) return {} as Record<string, number>;
  const { data, error } = await supabase
    .from("files")
    .select("folder_id")
    .in("folder_id", folderIds);
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
  onProgress?.(5);
  const { uploadUrl, storagePath } = await requestUploadUrl({
    data: {
      folderSlug: folder.slug,
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
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

export async function downloadFile(file: PortalFile) {
  const { url } = await requestDownloadUrl({
    data: { storagePath: file.storage_path, fileName: file.name, mode: "download" },
  });
  window.open(url, "_blank", "noopener");
}

/** Short-lived signed URL used to render a file inline in the preview modal. */
export async function createPreviewUrl(file: PortalFile): Promise<string> {
  const { url } = await requestDownloadUrl({
    data: { storagePath: file.storage_path, mode: "preview" },
  });
  return url;
}

export async function deleteFile(file: PortalFile) {
  const { error } = await supabase.from("files").delete().eq("id", file.id);
  if (error) throw error;
  await deleteObject({ data: { storagePath: file.storage_path } });
}

/**
 * Delete a folder and everything beneath it. Sub-folder rows and file metadata
 * cascade away in the database; stored objects are removed here.
 */
export async function deleteFolder(folder: Folder, all: Folder[] = []) {
  const ids = all.length ? subtreeIds(all, folder.id) : [folder.id];

  const { data: rows, error: listError } = await supabase
    .from("files")
    .select("storage_path")
    .in("folder_id", ids);
  if (listError) throw listError;

  const { error: deleteError } = await db.from("folders").delete().eq("id", folder.id);
  if (deleteError) throw deleteError;

  const paths = (rows ?? []).map((r) => r.storage_path);
  if (paths.length) await deleteObjects({ data: { storagePaths: paths } });
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
