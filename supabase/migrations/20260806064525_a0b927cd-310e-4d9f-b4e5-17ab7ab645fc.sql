CREATE POLICY "Move files between permitted folders"
ON public.files FOR UPDATE TO authenticated
USING (public.can_access_folder(folder_id))
WITH CHECK (public.can_access_folder(folder_id));

CREATE POLICY "Move permitted objects"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'company-files' AND public.can_access_slug((storage.foldername(name))[1]))
WITH CHECK (bucket_id = 'company-files' AND public.can_access_slug((storage.foldername(name))[1]));