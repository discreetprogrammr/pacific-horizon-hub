import { Link, useRouterState } from "@tanstack/react-router";
import { FolderClosed, LayoutGrid, ShieldCheck, Trash2 } from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import type { Folder, PortalProfile } from "@/lib/portal";

const LOGO_URL = "/pacific-horizon-tek-logo.png";

interface AppSidebarProps {
  folders: Folder[];
  profile: PortalProfile | null;
}

export function AppSidebar({ folders, profile }: AppSidebarProps) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (r) => r.location.pathname });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-3 py-4">
        <div className="flex items-center gap-2">
          {collapsed ? (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white p-1">
              <img
                src={LOGO_URL}
                alt="Pacific Horizon Tek Inc."
                className="h-8 w-auto max-w-none"
                style={{ objectFit: "cover", objectPosition: "left center", width: "auto" }}
              />
            </span>
          ) : (
            <div className="min-w-0">
              <span className="flex w-fit items-center rounded-lg bg-white px-2 py-1.5">
                <img
                  src={LOGO_URL}
                  alt="Pacific Horizon Tek Inc."
                  className="h-8 w-auto object-contain"
                />
              </span>
              <p className="mt-2 truncate text-[11px] text-sidebar-foreground/60">
                Internal Resource Portal
              </p>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === "/dashboard"}>
                  <Link to="/dashboard" className="flex items-center gap-2">
                    <LayoutGrid className="h-4 w-4" />
                    {!collapsed && <span>Dashboard</span>}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {profile?.role === "super_admin" && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={pathname === "/trash"}>
                    <Link to="/trash" className="flex items-center gap-2">
                      <Trash2 className="h-4 w-4" />
                      {!collapsed && <span>Recently Deleted</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Folders</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {folders.map((folder) => (
                <SidebarMenuItem key={folder.id}>
                  <SidebarMenuButton asChild isActive={pathname === `/folders/${folder.slug}`}>
                    <Link
                      to="/folders/$slug"
                      params={{ slug: folder.slug }}
                      className="flex items-center gap-2"
                    >
                      <FolderClosed className="h-4 w-4" />
                      {!collapsed && <span className="truncate">{folder.name}</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {!collapsed && (
        <SidebarFooter className="border-t border-sidebar-border p-3">
          <div className="flex items-start gap-2 text-[11px] text-sidebar-foreground/70">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {profile?.role === "super_admin"
                ? "Super Admin access — all departments"
                : `Restricted to ${profile?.department ?? "your department"}`}
            </span>
          </div>
        </SidebarFooter>
      )}
    </Sidebar>
  );
}
