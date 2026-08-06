
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.current_department() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.can_access_folder(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;

CREATE OR REPLACE FUNCTION public.can_access_slug(_slug text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(),'super_admin')
      OR EXISTS (SELECT 1 FROM public.folders f WHERE f.slug = _slug AND f.department = public.current_department());
$$;
REVOKE EXECUTE ON FUNCTION public.can_access_slug(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.can_access_slug(text) TO authenticated;

CREATE POLICY "Read permitted objects" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'company-files' AND public.can_access_slug((storage.foldername(name))[1]));
CREATE POLICY "Upload permitted objects" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'company-files' AND public.can_access_slug((storage.foldername(name))[1]));
CREATE POLICY "Super admins delete objects" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'company-files' AND public.has_role(auth.uid(),'super_admin'));
