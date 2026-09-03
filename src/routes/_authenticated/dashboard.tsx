import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderClosed, Lock, ShieldCheck, Upload } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
  TableHead,
} from "@/components/ui/table";
import {
  canRenameFolder,
  canWrite,
  softDeleteFolder,
  fetchAllFolders,
  firstNameOf,
  fetchFolderCounts,
  fetchProfile,
  renameFolderRow,
  subtreeIds,
  type Folder,
} from "@/lib/portal";
import { FolderCardMenu } from "@/components/portal/folder-card-menu";
import { ViewToggle } from "@/components/portal/view-toggle";
import { useViewMode } from "@/hooks/use-view-mode";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard | Pacific Horizon Tek Portal" },
      {
        name: "description",
        content:
          "Secure internal dashboard for Pacific Horizon Tek staff to access department document folders.",
      },
      { property: "og:title", content: "Dashboard | Pacific Horizon Tek Portal" },
      {
        property: "og:description",
        content: "Secure internal document dashboard for Pacific Horizon Tek staff.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useViewMode();
  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const { data: allFolders, isLoading } = useQuery({
    queryKey: ["folders", "all"],
    queryFn: fetchAllFolders,
  });
  const all: Folder[] = allFolders ?? [];
  const folders: Folder[] = all.filter((f) => f.parent_id === null);

  const { data: counts } = useQuery({
    queryKey: ["folder-counts", all.map((f) => f.id)],
    queryFn: () => fetchFolderCounts(all.map((f) => f.id)),
    enabled: all.length > 0,
  });

  // A department card counts everything stored in it, sub-folders included.
  const totalFor = (folder: Folder) =>
    subtreeIds(all, folder.id).reduce((sum, id) => sum + (counts?.[id] ?? 0), 0);

  const isAdmin = profile?.role === "super_admin";

  const removeFolder = useMutation({
    mutationFn: (folder: Folder) => {
      if (!profile) throw new Error("Your session has expired — sign in again");
      return softDeleteFolder(folder, all, profile.id);
    },
    onSuccess: () => {
      toast.success("Folder moved to Recently Deleted");
      queryClient.invalidateQueries({ queryKey: ["folders"] });
      queryClient.invalidateQueries({ queryKey: ["folder-counts"] });
    },
    onError: (error: Error) => toast.error(error.message || "Could not delete this folder"),
  });

  const renameFolder = useMutation({
    mutationFn: ({ target, name }: { target: Folder; name: string }) =>
      renameFolderRow(target, name),
    onSuccess: () => {
      toast.success("Folder renamed");
      queryClient.invalidateQueries({ queryKey: ["folders"] });
    },
    onError: (error: Error) => toast.error(error.message || "Could not rename this folder"),
  });

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <section className="brand-gradient relative overflow-hidden rounded-2xl px-6 py-8 text-primary-foreground shadow-[var(--shadow-elevated)]">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Welcome back{profile ? `, ${firstNameOf(profile)}!` : ""}
        </h1>
        <p className="mt-2 max-w-xl text-sm text-primary-foreground/80">
          Your secure workspace for company documents. Every file is encrypted at rest and delivered
          through short-lived signed links.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1">
            <ShieldCheck className="h-3.5 w-3.5" />
            {profile?.role === "super_admin"
              ? "Super Admin — full access"
              : `Department access — ${profile?.department ?? "—"}`}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1">
            <Lock className="h-3.5 w-3.5" />
            Private storage
          </span>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Your folders</h2>
            <p className="text-sm text-muted-foreground">
              Only folders permitted by your role are shown.
            </p>
          </div>
          <ViewToggle value={viewMode} onChange={setViewMode} />
        </div>

        {isLoading ? (
          viewMode === "grid" ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-40 rounded-2xl" />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 rounded-lg" />
              ))}
            </div>
          )
        ) : viewMode === "grid" ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {folders.map((folder) => {
              const writable = canWrite(profile ?? null, folder);
              const renamable = canRenameFolder(profile ?? null, folder);
              const displayName = folder.name;
              const fileCount = totalFor(folder);
              return (
                <Link
                  key={folder.id}
                  to="/folders/$slug"
                  params={{ slug: folder.slug }}
                  className="glass-card group flex flex-col rounded-2xl p-5 transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-elevated)]"
                >
                  <div className="flex items-start justify-between">
                    <span className="brand-gradient inline-flex h-11 w-11 items-center justify-center rounded-xl text-primary-foreground">
                      <FolderClosed className="h-5 w-5" />
                    </span>
                    <div className="flex items-center gap-1">
                      <Badge variant={writable ? "default" : "secondary"}>
                        {writable ? "Read & Upload" : "Read only"}
                      </Badge>
                      {renamable && (
                        <FolderCardMenu
                          name={displayName}
                          onRename={(next) => renameFolder.mutate({ target: folder, name: next })}
                          {...(isAdmin
                            ? {
                                onDelete: () => removeFolder.mutateAsync(folder),
                                deleting: removeFolder.isPending,
                                deleteDescription: `"${displayName}" and all ${fileCount} file(s) stored inside it will be moved to Recently Deleted. A super admin can restore it or delete it permanently from there.`,
                              }
                            : {})}
                        />
                      )}
                    </div>
                  </div>
                  <h3 className="mt-4 font-semibold tracking-tight">{displayName}</h3>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {folder.description}
                  </p>
                  <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
                    <span>{fileCount} files</span>

                    {writable && (
                      <span className="inline-flex items-center gap-1">
                        <Upload className="h-3.5 w-3.5" /> Upload enabled
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="glass-card overflow-hidden rounded-2xl">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Folder</TableHead>
                  <TableHead className="hidden sm:table-cell">Access</TableHead>
                  <TableHead className="hidden md:table-cell">Files</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {folders.map((folder) => {
                  const writable = canWrite(profile ?? null, folder);
                  const renamable = canRenameFolder(profile ?? null, folder);
                  const displayName = folder.name;
                  const fileCount = totalFor(folder);
                  return (
                    <TableRow
                      key={folder.id}
                      role="button"
                      tabIndex={0}
                      onClick={() =>
                        navigate({ to: "/folders/$slug", params: { slug: folder.slug } })
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          navigate({ to: "/folders/$slug", params: { slug: folder.slug } });
                        }
                      }}
                      className="cursor-pointer"
                    >
                      <TableCell className="font-medium">
                        <span className="flex items-center gap-3">
                          <span className="brand-gradient inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-primary-foreground">
                            <FolderClosed className="h-4 w-4" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate">{displayName}</span>
                            {folder.description && (
                              <span className="block truncate text-xs font-normal text-muted-foreground">
                                {folder.description}
                              </span>
                            )}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Badge variant={writable ? "default" : "secondary"}>
                          {writable ? "Read & Upload" : "Read only"}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground">
                        {fileCount} files
                      </TableCell>
                      <TableCell className="text-right">
                        {renamable && (
                          <FolderCardMenu
                            name={displayName}
                            onRename={(next) => renameFolder.mutate({ target: folder, name: next })}
                            {...(isAdmin
                              ? {
                                  onDelete: () => removeFolder.mutateAsync(folder),
                                  deleting: removeFolder.isPending,
                                  deleteDescription: `"${displayName}" and all ${fileCount} file(s) stored inside it will be moved to Recently Deleted. A super admin can restore it or delete it permanently from there.`,
                                }
                              : {})}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {!isLoading && (folders ?? []).length === 0 && (
          <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No folders are assigned to your account. Contact your administrator.
          </p>
        )}
      </section>
    </div>
  );
}
