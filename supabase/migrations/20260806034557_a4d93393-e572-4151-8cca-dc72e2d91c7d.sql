
CREATE TYPE public.app_role AS ENUM ('super_admin','department_user');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  department text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.current_department()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT department FROM public.profiles WHERE id = auth.uid();
$$;

CREATE TABLE public.folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  department text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.folders TO authenticated;
GRANT ALL ON public.folders TO service_role;
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id uuid NOT NULL REFERENCES public.folders(id) ON DELETE CASCADE,
  name text NOT NULL,
  size bigint NOT NULL DEFAULT 0,
  mime_type text,
  storage_path text NOT NULL UNIQUE,
  uploaded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.files TO authenticated;
GRANT ALL ON public.files TO service_role;
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_access_folder(_folder_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), 'super_admin')
      OR EXISTS (
        SELECT 1 FROM public.folders f
        WHERE f.id = _folder_id AND f.department = public.current_department()
      );
$$;

-- profiles policies
CREATE POLICY "Users read own profile" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- roles policies
CREATE POLICY "Users read own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'super_admin'));

-- folders policies
CREATE POLICY "Read permitted folders" ON public.folders FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'super_admin') OR department = public.current_department());

-- files policies
CREATE POLICY "Read permitted files" ON public.files FOR SELECT TO authenticated
  USING (public.can_access_folder(folder_id));
CREATE POLICY "Upload to permitted folders" ON public.files FOR INSERT TO authenticated
  WITH CHECK (public.can_access_folder(folder_id) AND uploaded_by = auth.uid());
CREATE POLICY "Super admins delete files" ON public.files FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'super_admin'));

-- pre-approved staff directory
CREATE TABLE public.seed_directory (
  email text PRIMARY KEY,
  role public.app_role NOT NULL,
  department text,
  full_name text
);
GRANT ALL ON public.seed_directory TO service_role;
ALTER TABLE public.seed_directory ENABLE ROW LEVEL SECURITY;

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
  ('pst@phtek.com.ph','department_user','HR and Admin','PST');

INSERT INTO public.folders (slug, name, description, department) VALUES
  ('hr-admin','HR and Admin','Policies, contracts and administrative documents','HR and Admin'),
  ('sales-marketing','Sales & Marketing','Proposals, collateral and campaign assets','Sales & Marketing'),
  ('technical','Technical Files','Manuals and site operations documentation','Technical');

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.seed_directory%ROWTYPE;
BEGIN
  SELECT * INTO d FROM public.seed_directory WHERE lower(email) = lower(NEW.email);
  INSERT INTO public.profiles (id, email, full_name, department)
  VALUES (NEW.id, NEW.email, COALESCE(d.full_name, NEW.raw_user_meta_data->>'full_name'), d.department);
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, COALESCE(d.role, 'department_user'))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
