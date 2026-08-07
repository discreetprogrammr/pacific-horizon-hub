-- =====================================================================
-- Pacific Horizon Tek Portal — persistent nested folders
-- Run ONCE in: Supabase Dashboard -> SQL Editor -> New query
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Schema: parent_id hierarchy + ownership on public.folders
-- ---------------------------------------------------------------------
ALTER TABLE public.folders
  ADD COLUMN IF NOT EXISTS parent_id uuid,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS owner_email text;

DO $$ BEGIN
  ALTER TABLE public.folders
    ADD CONSTRAINT folders_parent_id_fkey
    FOREIGN KEY (parent_id) REFERENCES public.folders(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.folders
    ADD CONSTRAINT folders_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS folders_parent_id_idx ON public.folders(parent_id);
CREATE INDEX IF NOT EXISTS files_folder_id_idx   ON public.files(folder_id);

-- files.folder_id must always point at a real folder and never fall back to null
ALTER TABLE public.files ALTER COLUMN folder_id SET NOT NULL;

-- ---------------------------------------------------------------------
-- 2. Grants (RLS still governs every row)
-- ---------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.folders TO authenticated;
GRANT ALL ON public.folders TO service_role;

ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- 3. RLS policies for nested folders
--    (read policy from full-setup.sql already covers sub-folders because
--     they inherit the parent's department value)
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Create permitted subfolders" ON public.folders;
CREATE POLICY "Create permitted subfolders" ON public.folders FOR INSERT TO authenticated
  WITH CHECK (
    parent_id IS NOT NULL
    AND private.can_access_folder(parent_id)
    AND (
      private.has_role(auth.uid(), 'super_admin')
      OR department = private.current_department()
    )
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS "Rename permitted folders" ON public.folders;
CREATE POLICY "Rename permitted folders" ON public.folders FOR UPDATE TO authenticated
  USING (
    private.has_role(auth.uid(), 'super_admin')
    OR (created_by = auth.uid() AND private.can_access_folder(id))
  )
  WITH CHECK (
    private.has_role(auth.uid(), 'super_admin')
    OR (created_by = auth.uid() AND private.can_access_folder(id))
  );

-- super admins delete anything; owners may delete their own sub-folders
DROP POLICY IF EXISTS "Super admins delete folders" ON public.folders;
DROP POLICY IF EXISTS "Delete permitted folders" ON public.folders;
CREATE POLICY "Delete permitted folders" ON public.folders FOR DELETE TO authenticated
  USING (
    private.has_role(auth.uid(), 'super_admin')
    OR (parent_id IS NOT NULL AND created_by = auth.uid()
        AND private.can_access_folder(id))
  );

-- ---------------------------------------------------------------------
-- 4. Realtime
-- ---------------------------------------------------------------------
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.folders;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.files;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- 5. Verify
-- ---------------------------------------------------------------------
-- SELECT id, slug, name, department, parent_id FROM public.folders ORDER BY parent_id NULLS FIRST, name;
