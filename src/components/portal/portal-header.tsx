import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { initialsOf, type PortalProfile } from "@/lib/portal";

export function PortalHeader({ profile }: { profile: PortalProfile | null }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    toast.success("Signed out");
    navigate({ to: "/", replace: true });
  }

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-card/80 px-4 backdrop-blur-md">
      <SidebarTrigger />

      <div className="ml-auto flex items-center gap-3">
        {profile && (
          <Badge
            variant={profile.role === "super_admin" ? "default" : "secondary"}
            className="hidden sm:inline-flex"
          >
            {profile.role === "super_admin"
              ? "Super Admin"
              : (profile.department ?? "Department User")}
          </Badge>
        )}
        <div className="hidden text-right leading-tight sm:block">
          <p className="text-sm font-medium">{profile?.full_name ?? "Staff"}</p>
          <p className="text-xs text-muted-foreground">{profile?.email}</p>
        </div>
        <Avatar className="h-9 w-9">
          <AvatarFallback className="bg-primary text-primary-foreground text-xs">
            {profile ? initialsOf(profile) : "PH"}
          </AvatarFallback>
        </Avatar>
        <Button variant="outline" size="sm" onClick={handleSignOut}>
          <LogOut className="mr-1.5 h-4 w-4" />
          Log out
        </Button>
      </div>
    </header>
  );
}
