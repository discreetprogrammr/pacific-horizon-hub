-- 1. Private schema for internal security helpers (not exposed via the Data API)
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
      OR EXISTS (
        SELECT 1 FROM public.folders f
        WHERE f.id = _folder_id AND f.department = private.current_department()
      );
$$;

CREATE OR REPLACE FUNCTION private.can_access_slug(_slug text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.has_role(auth.uid(), 'super_admin')
      OR EXISTS (
        SELECT 1 FROM public.folders f
        WHERE f.slug = _slug AND f.department = private.current_department()
      );
$$;

REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.current_department() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_access_folder(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_access_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.current_department() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.can_access_folder(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.can_access_slug(text) TO authenticated, service_role;

-- 2. Repoint every policy at the private helpers
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

-- 3. Scope the staff directory instead of exposing every profile
DROP POLICY IF EXISTS "Staff read directory" ON public.profiles;
CREATE POLICY "Read own, department and relevant profiles" ON public.profiles FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR private.has_role(auth.uid(), 'super_admin')
    OR (department IS NOT NULL AND department = private.current_department())
    OR EXISTS (
      SELECT 1 FROM public.files f
      WHERE f.uploaded_by = public.profiles.id
        AND private.can_access_folder(f.folder_id)
    )
  );

-- 4. Drop the public copies of the helpers and lock down the signup trigger helper
DROP FUNCTION IF EXISTS public.can_access_folder(uuid);
DROP FUNCTION IF EXISTS public.can_access_slug(text);
DROP FUNCTION IF EXISTS public.current_department();
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;