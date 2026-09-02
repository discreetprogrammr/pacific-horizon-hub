// Object storage on Cloudflare R2, gated by the same department /
// super_admin rules the old Supabase Storage RLS policies enforced (see
// supabase/full-setup.sql, section 5).
//
// R2 has no row-level security of its own, so every operation here first
// re-derives the caller's permission from Postgres — using the caller's
// own RLS-scoped Supabase client (from requireSupabaseAuth), never a
// service-role client — before touching the bucket. That keeps this file
// the single place object-storage permissions are enforced, mirroring:
//   - "Read/Upload/Move permitted objects": super_admin OR the object's
//     folder (first path segment) belongs to the caller's department.
//   - "Super admins delete objects": super_admin only.
//
// Every export below is a createServerFn — TanStack Start compiles each one
// into a thin client-side RPC stub and keeps the actual `.handler()` body
// (the AWS SDK client, the R2 credentials, the permission checks) on the
// server only; the browser bundle never sees the secrets. This file is
// deliberately NOT placed under src/server/ — the app's importProtection
// rule (vite.config.ts / @lovable.dev/vite-tanstack-config) hard-blocks the
// client from importing that path at all, even a file that, like this one,
// only exports serverFn stubs — so files client code needs to import (to
// get those stubs) have to live outside it.
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const UPLOAD_URL_TTL_SECONDS = 300;
const DOWNLOAD_URL_TTL_SECONDS = 60;
const PREVIEW_URL_TTL_SECONDS = 300;
const DELETE_BATCH_SIZE = 1000; // R2/S3 DeleteObjects hard limit per call

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Add it in your deployment's env vars.`,
    );
  }
  return value;
}

let client: S3Client | null = null;

/** Lazily-constructed R2 client, reused across invocations within one server instance. */
function r2(): S3Client {
  if (client) return client;
  client = new S3Client({
    region: "auto",
    endpoint: `https://${requiredEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requiredEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv("R2_SECRET_ACCESS_KEY"),
    },
  });
  return client;
}

function bucket(): string {
  return requiredEnv("R2_BUCKET_NAME");
}

/** Every object key is `${folderSlug}/${uuid}-${safeName}` — mirrors the old Supabase Storage layout. */
function folderSlugOf(storagePath: string): string {
  const slug = storagePath.split("/")[0];
  if (!slug) throw new Error("Invalid storage path");
  return slug;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^\w.\-() ]+/g, "_");
}

function buildObjectKey(folderSlug: string, fileName: string): string {
  return `${folderSlug}/${crypto.randomUUID()}-${sanitizeFileName(fileName)}`;
}

/** S3 CopySource needs each path segment percent-encoded, but the "/" separators kept literal. */
function encodeKeyForCopySource(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

/**
 * Mirrors `private.can_access_slug`: super_admin, or the slug names a folder
 * in the caller's own department. Relies on the caller's RLS-scoped client —
 * a department user simply gets no row back for a folder outside their
 * department, exactly like the SQL helper.
 */
async function assertSlugAccess(supabase: SupabaseClient, slug: string): Promise<void> {
  const { data, error } = await supabase
    .from("folders")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (error || !data) {
    throw new Error("Forbidden: you don't have access to this folder");
  }
}

/** Mirrors "Super admins delete objects": only super_admin may pass. */
async function assertSuperAdmin(supabase: SupabaseClient, userId: string): Promise<void> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .maybeSingle();
  if (error || !data) {
    throw new Error("Forbidden: this action is restricted to super admins");
  }
}

/** Presigned PUT URL for a new upload into `folderSlug`. Checked like the old "Upload permitted objects" policy. */
export const requestUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        folderSlug: z.string().min(1),
        fileName: z.string().min(1),
        contentType: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertSlugAccess(context.supabase, data.folderSlug);
    const storagePath = buildObjectKey(data.folderSlug, data.fileName);
    const uploadUrl = await getSignedUrl(
      r2(),
      new PutObjectCommand({
        Bucket: bucket(),
        Key: storagePath,
        ContentType: data.contentType || "application/octet-stream",
      }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS },
    );
    return { uploadUrl, storagePath };
  });

/** Presigned GET URL for downloading or previewing an existing object. Checked like "Read permitted objects". */
export const requestDownloadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        storagePath: z.string().min(1),
        fileName: z.string().optional(),
        mode: z.enum(["download", "preview"]).default("download"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertSlugAccess(context.supabase, folderSlugOf(data.storagePath));
    const url = await getSignedUrl(
      r2(),
      new GetObjectCommand({
        Bucket: bucket(),
        Key: data.storagePath,
        ...(data.mode === "download" && data.fileName
          ? {
              ResponseContentDisposition: `attachment; filename="${data.fileName.replace(/"/g, "")}"`,
            }
          : {}),
      }),
      { expiresIn: data.mode === "preview" ? PREVIEW_URL_TTL_SECONDS : DOWNLOAD_URL_TTL_SECONDS },
    );
    return { url };
  });

/** Server-side copy into another folder. Checked like "Read" (source) + "Upload" (destination) permitted objects. */
export const copyObjectToFolder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        sourcePath: z.string().min(1),
        destFolderSlug: z.string().min(1),
        fileName: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await Promise.all([
      assertSlugAccess(context.supabase, folderSlugOf(data.sourcePath)),
      assertSlugAccess(context.supabase, data.destFolderSlug),
    ]);
    const storagePath = buildObjectKey(data.destFolderSlug, data.fileName);
    await r2().send(
      new CopyObjectCommand({
        Bucket: bucket(),
        CopySource: `${bucket()}/${encodeKeyForCopySource(data.sourcePath)}`,
        Key: storagePath,
      }),
    );
    return { storagePath };
  });

/**
 * Server-side move (copy then delete the old key — R2/S3 has no atomic rename).
 * Checked like "Move permitted objects": can_access_slug on BOTH ends, no
 * super_admin requirement — this is the same call used to roll a move back,
 * so it must stay symmetric.
 */
export const moveObjectToFolder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        sourcePath: z.string().min(1),
        destFolderSlug: z.string().min(1),
        fileName: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await Promise.all([
      assertSlugAccess(context.supabase, folderSlugOf(data.sourcePath)),
      assertSlugAccess(context.supabase, data.destFolderSlug),
    ]);
    const storagePath = buildObjectKey(data.destFolderSlug, data.fileName);
    const s3 = r2();
    await s3.send(
      new CopyObjectCommand({
        Bucket: bucket(),
        CopySource: `${bucket()}/${encodeKeyForCopySource(data.sourcePath)}`,
        Key: storagePath,
      }),
    );
    await s3.send(new DeleteObjectCommand({ Bucket: bucket(), Key: data.sourcePath }));
    return { storagePath };
  });

/**
 * Moves an object to an exact, caller-specified key rather than a freshly
 * generated one. Used only to roll a failed `moveObjectToFolder` back to the
 * file's original `storage_path` — a fresh key there would leave the `files`
 * row (which was never updated, since the DB write is what failed) pointing
 * at an object that no longer exists. Same can_access_slug check on both ends.
 */
export const restoreObjectToPath = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        currentPath: z.string().min(1),
        restorePath: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await Promise.all([
      assertSlugAccess(context.supabase, folderSlugOf(data.currentPath)),
      assertSlugAccess(context.supabase, folderSlugOf(data.restorePath)),
    ]);
    const s3 = r2();
    await s3.send(
      new CopyObjectCommand({
        Bucket: bucket(),
        CopySource: `${bucket()}/${encodeKeyForCopySource(data.currentPath)}`,
        Key: data.restorePath,
      }),
    );
    await s3.send(new DeleteObjectCommand({ Bucket: bucket(), Key: data.currentPath }));
    return { ok: true };
  });

/** Deletes a single object. Checked like "Super admins delete objects". */
export const deleteObject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ storagePath: z.string().min(1) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.supabase, context.userId);
    await r2().send(new DeleteObjectCommand({ Bucket: bucket(), Key: data.storagePath }));
    return { ok: true };
  });

/** Bulk delete (folder removal). Same super_admin-only rule, batched under R2/S3's 1000-key limit. */
export const deleteObjects = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ storagePaths: z.array(z.string().min(1)) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    if (data.storagePaths.length === 0) return { ok: true };
    await assertSuperAdmin(context.supabase, context.userId);
    const s3 = r2();
    for (let i = 0; i < data.storagePaths.length; i += DELETE_BATCH_SIZE) {
      const batch = data.storagePaths.slice(i, i + DELETE_BATCH_SIZE);
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket(),
          Delete: { Objects: batch.map((Key) => ({ Key })) },
        }),
      );
    }
    return { ok: true };
  });
