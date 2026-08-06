import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, LogOut } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ChangePasswordDialog } from "@/components/portal/change-password-dialog";
import { initialsOf, type PortalProfile } from "@/lib/portal";

export function PortalHeader({ profile }: { profile: PortalProfile | null }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [passwordOpen, setPasswordOpen] = useState(false);

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

      <div className="flex min-w-0 items-center gap-2">
        <span className="flex h-12 items-center rounded-lg bg-white px-3 shadow-sm ring-1 ring-border">
          <img
            src={logo.url}
            alt="Pacific Horizon Tek Inc."
            className="h-10 w-auto object-contain"
          />
        </span>
        <span className="hidden truncate text-sm font-semibold tracking-tight md:inline">
          Pacific Horizon Tek
        </span>
      </div>

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

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Account menu" className="rounded-full">
              <Avatar className="h-9 w-9">
                <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                  {profile ? initialsOf(profile) : "PH"}
                </AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="truncate">
              {profile?.email ?? "Account"}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setPasswordOpen(true)}>
              <KeyRound className="mr-2 h-4 w-4" />
              Change password
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleSignOut}>
              <LogOut className="mr-2 h-4 w-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="outline" size="sm" onClick={handleSignOut}>
          <LogOut className="mr-1.5 h-4 w-4" />
          Log out
        </Button>
      </div>

      <ChangePasswordDialog
        email={profile?.email}
        open={passwordOpen}
        onOpenChange={setPasswordOpen}
      />
    </header>
  );
}
