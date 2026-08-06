
DROP POLICY IF EXISTS "Users read own profile" ON public.profiles;
CREATE POLICY "Staff read directory" ON public.profiles FOR SELECT TO authenticated USING (true);
