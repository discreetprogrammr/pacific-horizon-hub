ALTER TABLE public.files DROP CONSTRAINT IF EXISTS files_folder_id_fkey;
ALTER TABLE public.files ADD CONSTRAINT files_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.folders(id) ON DELETE CASCADE;

GRANT DELETE ON public.folders TO authenticated;

CREATE POLICY "Super admins delete folders"
ON public.folders
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'super_admin'));