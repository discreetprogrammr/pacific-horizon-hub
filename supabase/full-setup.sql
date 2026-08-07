-- =====================================================================
-- Pacific Horizon Tek Portal — complete backend setup
-- Run this ONCE in: Supabase Dashboard -> SQL Editor -> New query
-- Target project: bqvqmajglwpllqtczjwl
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ENUM
-- ---------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('super_admin','department_user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- 2. TABLES + GRANTS + RLS ENABLE
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  department text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  department text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, DELETE ON public.folders TO authenticated;
GRANT ALL ON public.folders TO service_role;
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id uuid NOT NULL REFERENCES public.folders(id) ON DELETE CASCADE,
  name text NOT NULL,
  size bigint NOT NULL DEFAULT 0,
  mime_type text,
  storage_path text NOT NULL UNIQUE,
  uploaded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.files TO authenticated;
GRANT ALL ON public.files TO service_role;
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.seed_directory (
  email text PRIMARY KEY,
  role public.app_role NOT NULL,
  department text,
  full_name text
);
GRANT ALL ON public.seed_directory TO service_role;
ALTER TABLE public.seed_directory ENABLE ROW LEVEL SECURITY;
-- no policies: readable only by service_role / SECURITY DEFINER trigger

-- ---------------------------------------------------------------------
-- 3. PRIVATE SECURITY-DEFINER HELPERS (not exposed on the Data API)
-- ---------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION private.current_department()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT department FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION private.can_access_folder(_folder_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.has_role(auth.uid(), 'super_admin')
      OR EXISTS (SELECT 1 FROM public.folders f
                 WHERE f.id = _folder_id AND f.department = private.current_department());
$$;

CREATE OR REPLACE FUNCTION private.can_access_slug(_slug text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.has_role(auth.uid(), 'super_admin')
      OR EXISTS (SELECT 1 FROM public.folders f
                 WHERE f.slug = _slug AND f.department = private.current_department());
$$;

REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.current_department() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_access_folder(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_access_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.current_department() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.can_access_folder(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.can_access_slug(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. RLS POLICIES
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Read own, department and relevant profiles" ON public.profiles;
CREATE POLICY "Read own, department and relevant profiles" ON public.profiles FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR private.has_role(auth.uid(), 'super_admin')
    OR (department IS NOT NULL AND department = private.current_department())
    OR EXISTS (SELECT 1 FROM public.files f
               WHERE f.uploaded_by = public.profiles.id
                 AND private.can_access_folder(f.folder_id))
  );

DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "Users read own roles" ON public.user_roles;
CREATE POLICY "Users read own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Read permitted folders" ON public.folders;
CREATE POLICY "Read permitted folders" ON public.folders FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'super_admin') OR department = private.current_department());

DROP POLICY IF EXISTS "Super admins delete folders" ON public.folders;
CREATE POLICY "Super admins delete folders" ON public.folders FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Read permitted files" ON public.files;
CREATE POLICY "Read permitted files" ON public.files FOR SELECT TO authenticated
  USING (private.can_access_folder(folder_id));

DROP POLICY IF EXISTS "Upload to permitted folders" ON public.files;
CREATE POLICY "Upload to permitted folders" ON public.files FOR INSERT TO authenticated
  WITH CHECK (private.can_access_folder(folder_id) AND uploaded_by = auth.uid());

DROP POLICY IF EXISTS "Move files between permitted folders" ON public.files;
CREATE POLICY "Move files between permitted folders" ON public.files FOR UPDATE TO authenticated
  USING (private.can_access_folder(folder_id)) WITH CHECK (private.can_access_folder(folder_id));

DROP POLICY IF EXISTS "Super admins delete files" ON public.files;
CREATE POLICY "Super admins delete files" ON public.files FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'super_admin'));

-- ---------------------------------------------------------------------
-- 5. PRIVATE STORAGE BUCKET + OBJECT POLICIES
-- ---------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('company-files', 'company-files', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "Read permitted objects" ON storage.objects;
CREATE POLICY "Read permitted objects" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'company-files' AND private.can_access_slug((storage.foldername(name))[1]));

DROP POLICY IF EXISTS "Upload permitted objects" ON storage.objects;
CREATE POLICY "Upload permitted objects" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'company-files' AND private.can_access_slug((storage.foldername(name))[1]));

DROP POLICY IF EXISTS "Move permitted objects" ON storage.objects;
CREATE POLICY "Move permitted objects" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'company-files' AND private.can_access_slug((storage.foldername(name))[1]))
  WITH CHECK (bucket_id = 'company-files' AND private.can_access_slug((storage.foldername(name))[1]));

DROP POLICY IF EXISTS "Super admins delete objects" ON storage.objects;
CREATE POLICY "Super admins delete objects" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'company-files' AND private.has_role(auth.uid(), 'super_admin'));

-- ---------------------------------------------------------------------
-- 6. SEED DATA — staff directory + root folders
-- ---------------------------------------------------------------------
INSERT INTO public.seed_directory (email, role, department, full_name) VALUES
  ('lal@phtek.com.ph','super_admin',NULL,'LAL'),
  ('rdh@phtek.com.ph','super_admin',NULL,'RDH'),
  ('pth@phtek.com.ph','super_admin',NULL,'PTH'),
  ('smp@phtek.com.ph','super_admin',NULL,'SMP'),
  ('gsc@phtek.com.ph','department_user','Technical','GSC'),
  ('info@phtek.com.ph','department_user','Sales & Marketing','Info'),
  ('jmt@phtek.com.ph','department_user','Sales & Marketing','JMT'),
  ('marketing@phtek.com.ph','department_user','Sales & Marketing','Marketing'),
  ('sales@phtek.com.ph','department_user','Sales & Marketing','Sales'),
  ('pst@phtek.com.ph','department_user','HR and Admin','PST')
ON CONFLICT (email) DO UPDATE
  SET role = EXCLUDED.role, department = EXCLUDED.department, full_name = EXCLUDED.full_name;

INSERT INTO public.folders (slug, name, description, department) VALUES
  ('hr-admin','HR and Admin','Policies, contracts and administrative documents','HR and Admin'),
  ('sales-marketing','Sales & Marketing','Proposals, collateral and campaign assets','Sales & Marketing'),
  ('technical','Technical Files','Manuals and site operations documentation','Technical')
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------
-- 7. SIGNUP TRIGGER — assigns role + department from seed_directory
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.seed_directory%ROWTYPE;
BEGIN
  SELECT * INTO d FROM public.seed_directory WHERE lower(email) = lower(NEW.email);
  INSERT INTO public.profiles (id, email, full_name, department)
  VALUES (NEW.id, NEW.email, COALESCE(d.full_name, NEW.raw_user_meta_data->>'full_name'), d.department)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, COALESCE(d.role, 'department_user'))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =====================================================================
-- 8. ACCOUNTS — create these in Dashboard -> Authentication -> Users
--    -> "Add user" -> "Create new user", tick "Auto Confirm User".
--    The trigger above assigns the correct role + department by email.
--
--    Super admins:      lal@phtek.com.ph, rdh@phtek.com.ph,
--                       pth@phtek.com.ph, smp@phtek.com.ph
--    Technical:         gsc@phtek.com.ph
--    Sales & Marketing: info@, jmt@, marketing@, sales@phtek.com.ph
--    HR and Admin:      pst@phtek.com.ph
--
--    Also turn OFF Authentication -> Sign In / Providers -> "Allow new
--    users to sign up" so the portal stays invite-only.
--
--    Verify afterwards:
--      SELECT p.email, p.department, r.role
--      FROM public.profiles p JOIN public.user_roles r ON r.user_id = p.id
--      ORDER BY r.role, p.email;
-- =====================================================================

-- =====================================================================
-- 9. Profile name columns (first_name / last_name)  [idempotent]
-- =====================================================================
alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name  text;

-- Backfill from existing full_name where possible
update public.profiles
   set first_name = coalesce(first_name, split_part(full_name, ' ', 1)),
       last_name  = coalesce(
         last_name,
         nullif(regexp_replace(full_name, '^\S+\s*', ''), '')
       )
 where full_name is not null;
