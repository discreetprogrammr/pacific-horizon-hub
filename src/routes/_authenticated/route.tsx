import { createFileRoute, redirect, Outlet, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { supabase } from "@/integrations/supabase/client";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/portal/app-sidebar";
import { PortalHeader } from "@/components/portal/portal-header";
import { fetchFolders, fetchProfile } from "@/lib/portal";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/" });
    return { user: data.user };
  },
  component: PortalLayout,
});

function PortalLayout() {
  const router = useRouter();
  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const { data: folders } = useQuery({ queryKey: ["folders"], queryFn: fetchFolders });

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") router.navigate({ to: "/", replace: true });
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar folders={folders ?? []} profile={profile ?? null} />
        <div className="flex min-w-0 flex-1 flex-col">
          <PortalHeader profile={profile ?? null} />
          <main className="flex-1 px-4 py-6 sm:px-8">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
