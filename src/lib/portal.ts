import { supabase } from "@/integrations/supabase/client";

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

  const [{ data: profile }, { data: roles }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, full_name, department")
      .eq("id", user.id)
      .maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", user.id),
  ]);

  const role: AppRole = (roles ?? []).some((r) => r.role === "super_admin")
    ? "super_admin"
    : "department_user";

  return {
    id: user.id,
    email: profile?.email ?? user.email ?? "",
    full_name: profile?.full_name ?? null,
    department: profile?.department ?? null,
    role,
  };
}

export async function fetchFolders(): Promise<Folder[]> {
  const { data, error } = await supabase
    .from("folders")
    .select("id, slug, name, description, department")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function fetchFolderBySlug(slug: string): Promise<Folder | null> {
  const { data, error } = await supabase
    .from("folders")
    .select("id, slug, name, description, department")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return data;
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
  const { error: insertError } = await supabase.from("files").insert({
    folder_id: folder.id,
    name: file.name,
    size: file.size,
    mime_type: file.type || null,
    storage_path: path,
    uploaded_by: userId,
  });
  if (insertError) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw insertError;
  }
  onProgress?.(100);
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
 * Delete a department folder: removes its stored objects, then the folder row.
 * File metadata rows cascade away with the folder. RLS limits this to super admins.
 */
export async function deleteFolder(folder: Folder) {
  const { data: rows, error: listError } = await supabase
    .from("files")
    .select("storage_path")
    .eq("folder_id", folder.id);
  if (listError) throw listError;

  const { error: deleteError } = await supabase
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
  const source = profile.full_name || profile.email;
  return source.slice(0, 2).toUpperCase();
}
