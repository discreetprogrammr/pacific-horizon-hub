#!/usr/bin/env node
// One-time migration: copy every file object out of Supabase Storage's
// "company-files" bucket into the new Cloudflare R2 bucket, using the exact
// same key (storage_path) each file already has in the `files` table.
// Because keys are preserved, existing `files.storage_path` DB rows keep
// working unchanged after the app is switched over to R2 — no DB migration
// needed.
//
// This script only COPIES. It never deletes or modifies anything in
// Supabase Storage, so the old bucket stays intact as a safety net until
// you've verified the app works end-to-end against R2. Delete the old
// bucket's contents yourself, later, once you're confident.
//
// It is safe to re-run: any object that already exists in R2 (same key,
// same size) is skipped, so an interrupted run can simply be started again.
//
// Usage (run from the repo root, after `npm install`):
//
//   SUPABASE_URL=https://bqvqmajglwpllqtczjwl.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service role key, from Supabase Dashboard -> Project Settings -> API> \
//   R2_ACCOUNT_ID=<your Cloudflare account id> \
//   R2_ACCESS_KEY_ID=<from the R2 API token> \
//   R2_SECRET_ACCESS_KEY=<from the R2 API token> \
//   R2_BUCKET_NAME=pacific-horizon-hub-files \
//   node migrate-storage-to-r2.mjs
//
// Add DRY_RUN=1 to list what would happen without copying anything.
// Add CONCURRENCY=8 to change how many files transfer in parallel (default 4).
//
// The service role key bypasses Row Level Security, which is required here
// — a normal user's key would only ever see their own department's files.
// Never commit it or put it in a file that's part of the repo.

import { createClient } from "@supabase/supabase-js";
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const SOURCE_BUCKET = "company-files";
const PAGE_SIZE = 200;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

const SUPABASE_URL = requiredEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const R2_ACCOUNT_ID = requiredEnv("R2_ACCOUNT_ID");
const R2_ACCESS_KEY_ID = requiredEnv("R2_ACCESS_KEY_ID");
const R2_SECRET_ACCESS_KEY = requiredEnv("R2_SECRET_ACCESS_KEY");
const R2_BUCKET_NAME = requiredEnv("R2_BUCKET_NAME");
const DRY_RUN = process.env.DRY_RUN === "1";
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY) || 4);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

async function fetchAllFileRows() {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("files")
      .select("id, name, size, mime_type, storage_path")
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

async function alreadyMigrated(key, expectedSize) {
  try {
    const head = await r2.send(
      new HeadObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }),
    );
    if (typeof expectedSize === "number" && expectedSize > 0) {
      return head.ContentLength === expectedSize;
    }
    return true;
  } catch {
    return false;
  }
}

async function migrateOne(row, results) {
  const label = `${row.storage_path}  ("${row.name}")`;
  try {
    if (await alreadyMigrated(row.storage_path, row.size)) {
      results.skipped.push(row.storage_path);
      console.log(`skip (already in R2): ${label}`);
      return;
    }

    if (DRY_RUN) {
      results.wouldMigrate.push(row.storage_path);
      console.log(`would copy: ${label}`);
      return;
    }

    const { data: blob, error: downloadError } = await supabase.storage
      .from(SOURCE_BUCKET)
      .download(row.storage_path);
    if (downloadError || !blob) {
      throw downloadError ?? new Error("empty download response");
    }

    const bytes = Buffer.from(await blob.arrayBuffer());
    if (row.size && bytes.length !== row.size) {
      console.warn(
        `  note: downloaded ${bytes.length} bytes, DB says ${row.size} bytes — uploading anyway (${label})`,
      );
    }

    await r2.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: row.storage_path,
        Body: bytes,
        ContentType: row.mime_type || "application/octet-stream",
      }),
    );

    results.migrated.push(row.storage_path);
    console.log(`copied: ${label} (${bytes.length} bytes)`);
  } catch (err) {
    results.failed.push({ path: row.storage_path, name: row.name, error: String(err) });
    console.error(`FAILED: ${label} — ${err}`);
  }
}

async function runPool(items, worker, concurrency) {
  let cursor = 0;
  async function next() {
    while (cursor < items.length) {
      const i = cursor++;
      await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
}

async function main() {
  console.log(`Fetching file list from Supabase (bypassing RLS via service role)...`);
  const rows = await fetchAllFileRows();
  console.log(`Found ${rows.length} file row(s) in the "files" table.`);
  if (DRY_RUN) console.log(`DRY_RUN=1 — nothing will actually be copied.\n`);

  const results = { migrated: [], skipped: [], failed: [], wouldMigrate: [] };
  await runPool(rows, (row) => migrateOne(row, results), CONCURRENCY);

  console.log(`\n=== Summary ===`);
  console.log(`Total file rows:     ${rows.length}`);
  if (DRY_RUN) {
    console.log(`Would copy:          ${results.wouldMigrate.length}`);
  } else {
    console.log(`Copied:              ${results.migrated.length}`);
  }
  console.log(`Already in R2:       ${results.skipped.length}`);
  console.log(`Failed:              ${results.failed.length}`);

  if (results.failed.length > 0) {
    console.log(`\nFailed files:`);
    for (const f of results.failed) {
      console.log(`  - ${f.path} ("${f.name}"): ${f.error}`);
    }
    console.log(
      `\nRe-run this script (it skips anything already copied) once the cause above is fixed.`,
    );
    process.exitCode = 1;
  } else if (!DRY_RUN) {
    console.log(
      `\nAll files copied. Supabase Storage was left untouched — verify the app works ` +
        `against R2 (upload/download/preview/move/delete, as both a department user and a ` +
        `super admin) before deleting anything from the old "company-files" bucket.`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
