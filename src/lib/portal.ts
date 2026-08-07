import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

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

export const BUCKET = "company-files";


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

  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);

  const profile = base.data as
    | {
        email?: string | null;
        full_name?: string | null;
        department?: string | null;
        first_name?: string | null;
        last_name?: string | null;
      }
    | null;

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
  const composed = [profile.first_name, profile.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
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
  const { data, error } = await db
    .from("folders")
    .select(FOLDER_COLUMNS)
    .order("name");
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
  const { error } = await db
    .from("folders")
    .update({ name: name.trim() })
    .eq("id", folder.id);
  if (error) throw error;
}

/** Super admins rename anything; creators rename the folders they made. */
export function canRenameFolder(
  profile: PortalProfile | null,
  folder: Folder | null,
) {
  if (!profile || !folder) return false;
  if (profile.role === "super_admin") return true;
  return !!folder.owner_email && folder.owner_email === profile.email;
}


export async function fetchFiles(folderId: string): Promise<PortalFile[]> {
  const { data, error } = await supabase
    .from("files")
    .select(
      "id, folder_id, name, size, mime_type, storage_path, uploaded_by, created_at",
    )
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

  const byId = new Map(
    (people ?? []).map((p) => [p.id, p.full_name || p.email] as const),
  );
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

export async function uploadFile(
  folder: Folder,
  file: File,
  userId: string,
  onProgress?: (pct: number) => void,
) {
  const safeName = file.name.replace(/[^\w.\-() ]+/g, "_");
  const path = `${folder.slug}/${crypto.randomUUID()}-${safeName}`;

  onProgress?.(15);
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || "application/octet-stream" });
  if (uploadError) throw uploadError;

  onProgress?.(80);
  const { data: inserted, error: insertError } = await supabase
    .from("files")
    .insert({
      folder_id: folder.id,
      name: file.name,
      size: file.size,
      mime_type: file.type || null,
      storage_path: path,
      uploaded_by: userId,
    })
    .select("id")
    .single();
  if (insertError) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw insertError;
  }
  onProgress?.(100);
  return inserted?.id ?? null;
}

export async function downloadFile(file: PortalFile) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(file.storage_path, 60, { download: file.name });
  if (error || !data) throw error ?? new Error("Could not create download link");
  window.open(data.signedUrl, "_blank", "noopener");
}

/** Short-lived signed URL used to render a file inline in the preview modal. */
export async function createPreviewUrl(file: PortalFile): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(file.storage_path, 300);
  if (error || !data) throw error ?? new Error("Could not create preview link");
  return data.signedUrl;
}

export async function deleteFile(file: PortalFile) {
  const { error } = await supabase.from("files").delete().eq("id", file.id);
  if (error) throw error;
  await supabase.storage.from(BUCKET).remove([file.storage_path]);
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

  const { error: deleteError } = await db
    .from("folders")
    .delete()
    .eq("id", folder.id);
  if (deleteError) throw deleteError;

  const paths = (rows ?? []).map((r) => r.storage_path);
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
}



function targetPath(folder: Folder, fileName: string) {
  const safeName = fileName.replace(/[^\w.\-() ]+/g, "_");
  return `${folder.slug}/${crypto.randomUUID()}-${safeName}`;
}

/** Duplicate a file's storage object and metadata row into another folder. */
export async function copyFileToFolder(
  file: PortalFile,
  target: Folder,
  userId: string,
) {
  const path = targetPath(target, file.name);
  const { error: copyError } = await supabase.storage
    .from(BUCKET)
    .copy(file.storage_path, path);
  if (copyError) throw copyError;

  const { data: inserted, error: insertError } = await supabase
    .from("files")
    .insert({
      folder_id: target.id,
      name: file.name,
      size: file.size,
      mime_type: file.mime_type,
      storage_path: path,
      uploaded_by: userId,
    })
    .select("id")
    .single();
  if (insertError) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw insertError;
  }
  return inserted?.id as string | undefined;
}

/** Move a file's storage object and update its folder reference. */
export async function moveFileToFolder(file: PortalFile, target: Folder) {
  if (file.folder_id === target.id) return;
  const path = targetPath(target, file.name);
  const { error: moveError } = await supabase.storage
    .from(BUCKET)
    .move(file.storage_path, path);
  if (moveError) throw moveError;

  const { error: updateError } = await supabase
    .from("files")
    .update({ folder_id: target.id, storage_path: path })
    .eq("id", file.id);
  if (updateError) {
    // roll the object back so metadata and storage stay in sync
    await supabase.storage.from(BUCKET).move(path, file.storage_path);
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
