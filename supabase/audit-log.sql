-- =====================================================================
-- Pacific Horizon Tek Portal — silent backend audit logging
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABLE + GRANTS + RLS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.activity_audit_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action     text NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  table_name text NOT NULL,
  record_id  uuid,
  metadata   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_audit_log_created_at_idx
  ON public.activity_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS activity_audit_log_record_idx
  ON public.activity_audit_log (table_name, record_id);
CREATE INDEX IF NOT EXISTS activity_audit_log_user_idx
  ON public.activity_audit_log (user_id);

-- Backend-only: no Data API access for app users at all.
REVOKE ALL ON public.activity_audit_log FROM anon, authenticated;
GRANT ALL ON public.activity_audit_log TO service_role;

ALTER TABLE public.activity_audit_log ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only service_role / SECURITY DEFINER writers can touch it.

-- ---------------------------------------------------------------------
-- 2. GENERIC TRIGGER FUNCTION
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_activity_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record_id uuid;
  v_metadata  jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_record_id := OLD.id;
    v_metadata  := jsonb_build_object('old', to_jsonb(OLD));
  ELSIF TG_OP = 'UPDATE' THEN
    v_record_id := NEW.id;
    v_metadata  := jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW));
  ELSE
    v_record_id := NEW.id;
    v_metadata  := jsonb_build_object('new', to_jsonb(NEW));
  END IF;

  INSERT INTO public.activity_audit_log (user_id, action, table_name, record_id, metadata)
  VALUES (auth.uid(), TG_OP, TG_TABLE_NAME, v_record_id, v_metadata);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.log_activity_audit() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. TRIGGERS ON files AND folders
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS audit_files ON public.files;
CREATE TRIGGER audit_files
AFTER INSERT OR UPDATE OR DELETE ON public.files
FOR EACH ROW EXECUTE FUNCTION public.log_activity_audit();

DROP TRIGGER IF EXISTS audit_folders ON public.folders;
CREATE TRIGGER audit_folders
AFTER INSERT OR UPDATE OR DELETE ON public.folders
FOR EACH ROW EXECUTE FUNCTION public.log_activity_audit();

-- ---------------------------------------------------------------------
-- 4. VERIFY
-- ---------------------------------------------------------------------
-- SELECT created_at, action, table_name, record_id, user_id
-- FROM public.activity_audit_log ORDER BY created_at DESC LIMIT 20;
