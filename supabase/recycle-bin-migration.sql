-- =====================================================================
-- 10. Recycle bin (soft delete) for folders and files  [idempotent]
-- =====================================================================
-- "Delete" now sets deleted_at/deleted_by instead of removing the row.
-- Ordinary reads (fetchAllFolders, fetchFiles, ...) filter deleted_at is
-- null, so a deleted item simply disappears from the normal UI; a
-- super-admin-only "Recently Deleted" view lists deleted_at is not null
-- rows and can restore them (clear the columns) or purge them for good
-- (the pre-existing hard DELETE policies below, unchanged).
--
-- RLS has no column-level granularity, and the existing UPDATE policies on
-- both tables already let an ordinary department user update rows in
-- their own department (files, for the move feature; folders, for
-- rename — see the "Update permitted folders" policy just below, which
-- this file previously omitted even though renaming already worked
-- live, i.e. some equivalent policy already existed in the database
-- before this section ever ran). Either policy would also let that same
-- user toggle deleted_at if nothing else stopped them. A BEFORE UPDATE
-- trigger closes that gap: it raises unless the caller is super_admin
-- AND deleted_at/deleted_by is actually the thing changing, so every
-- other UPDATE (rename, move, etc.) is left untouched.

alter table public.folders add column if not exists deleted_at timestamptz;
alter table public.folders add column if not exists deleted_by uuid references auth.users(id) on delete set null;
alter table public.files   add column if not exists deleted_at timestamptz;
alter table public.files   add column if not exists deleted_by uuid references auth.users(id) on delete set null;

create index if not exists folders_deleted_at_idx on public.folders (deleted_at);
create index if not exists files_deleted_at_idx   on public.files   (deleted_at);

-- Re-declared explicitly (idempotent) so soft-delete can rely on it: super
-- admins can update any folder, department users only their own
-- department's — same shape as every other policy in this file.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.folders TO authenticated;

DROP POLICY IF EXISTS "Update permitted folders" ON public.folders;
CREATE POLICY "Update permitted folders" ON public.folders FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'super_admin') OR department = private.current_department())
  WITH CHECK (private.has_role(auth.uid(), 'super_admin') OR department = private.current_department());

CREATE OR REPLACE FUNCTION private.enforce_admin_only_delete_toggle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (NEW.deleted_at IS DISTINCT FROM OLD.deleted_at OR NEW.deleted_by IS DISTINCT FROM OLD.deleted_by)
     AND NOT private.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Forbidden: only super admins can delete or restore this item';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.enforce_admin_only_delete_toggle() FROM PUBLIC;

DROP TRIGGER IF EXISTS folders_admin_only_delete_toggle ON public.folders;
CREATE TRIGGER folders_admin_only_delete_toggle
BEFORE UPDATE ON public.folders
FOR EACH ROW EXECUTE FUNCTION private.enforce_admin_only_delete_toggle();

DROP TRIGGER IF EXISTS files_admin_only_delete_toggle ON public.files;
CREATE TRIGGER files_admin_only_delete_toggle
BEFORE UPDATE ON public.files
FOR EACH ROW EXECUTE FUNCTION private.enforce_admin_only_delete_toggle();
