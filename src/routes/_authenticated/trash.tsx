import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FileText, FolderClosed, Loader2, RotateCcw, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  deleteFile,
  deleteFolder,
  fetchAllFoldersIncludingDeleted,
  fetchDeletedFiles,
  fetchDeletedFolders,
  fetchProfile,
  formatDate,
  restoreFile,
  restoreFolder,
  type Folder,
  type PortalFile,
} from "@/lib/portal";

export const Route = createFileRoute("/_authenticated/trash")({
  head: () => ({
    meta: [
      { title: "Recently Deleted | Pacific Horizon Tek Portal" },
      {
        name: "description",
        content: "Restore or permanently remove recently deleted folders and files.",
      },
    ],
  }),
  component: Trash,
});

type PurgeTarget = { kind: "folder"; folder: Folder } | { kind: "file"; file: PortalFile };

function Trash() {
  const queryClient = useQueryClient();
  const [purgeTarget, setPurgeTarget] = useState<PurgeTarget | null>(null);

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["profile"],
    queryFn: fetchProfile,
  });
  const isAdmin = profile?.role === "super_admin";

  // Includes already-deleted folders too — needed both to resolve a
  // deleted file's folder name below, and to walk the full subtree when
  // restoring a folder.
  const { data: allFolders } = useQuery({
    queryKey: ["folders", "all-including-deleted"],
    queryFn: fetchAllFoldersIncludingDeleted,
    enabled: isAdmin,
  });
  const all: Folder[] = allFolders ?? [];
  const folderNameOf = (id: string) => all.find((f) => f.id === id)?.name ?? "Unknown folder";
  // Deleted folders render as a flat list, but a cascade-delete can carry
  // several levels of sub-folders into it at once — this gives each row
  // enough context to tell them apart, whether the parent was deleted too
  // or is still active elsewhere.
  const parentNameOf = (folder: Folder) =>
    folder.parent_id ? (all.find((f) => f.id === folder.parent_id)?.name ?? null) : null;

  const { data: deletedFolders, isLoading: foldersLoading } = useQuery({
    queryKey: ["folders", "deleted"],
    queryFn: fetchDeletedFolders,
    enabled: isAdmin,
  });

  const { data: deletedFiles, isLoading: filesLoading } = useQuery({
    queryKey: ["files", "deleted"],
    queryFn: fetchDeletedFiles,
    enabled: isAdmin,
  });

  function invalidateAfterChange() {
    queryClient.invalidateQueries({ queryKey: ["folders"] });
    queryClient.invalidateQueries({ queryKey: ["files"] });
    queryClient.invalidateQueries({ queryKey: ["folder-counts"] });
  }

  const restoreFolderMutation = useMutation({
    mutationFn: (folder: Folder) => restoreFolder(folder, all),
    onSuccess: () => {
      toast.success("Folder restored");
      invalidateAfterChange();
    },
    onError: (error: Error) => toast.error(error.message || "Could not restore this folder"),
  });

  const restoreFileMutation = useMutation({
    mutationFn: (file: PortalFile) => restoreFile(file),
    onSuccess: () => {
      toast.success("File restored");
      invalidateAfterChange();
    },
    onError: (error: Error) => toast.error(error.message || "Could not restore this file"),
  });

  const purgeFolder = useMutation({
    mutationFn: (folder: Folder) => deleteFolder(folder, all),
    onSuccess: () => {
      toast.success("Folder permanently deleted");
      invalidateAfterChange();
    },
    onError: (error: Error) => toast.error(error.message || "Could not delete this folder"),
  });

  const purgeFile = useMutation({
    mutationFn: (file: PortalFile) => deleteFile(file),
    onSuccess: () => {
      toast.success("File permanently deleted");
      invalidateAfterChange();
    },
    onError: (error: Error) => toast.error(error.message || "Could not delete this file"),
  });

  async function confirmPurge() {
    if (!purgeTarget) return;
    if (purgeTarget.kind === "folder") {
      await purgeFolder.mutateAsync(purgeTarget.folder);
    } else {
      await purgeFile.mutateAsync(purgeTarget.file);
    }
    setPurgeTarget(null);
  }

  if (profileLoading) {
    return <Skeleton className="mx-auto h-64 w-full max-w-6xl rounded-2xl" />;
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-dashed border-border p-10 text-center">
        <ShieldAlert className="mx-auto h-6 w-6 text-muted-foreground" />
        <h2 className="mt-3 font-semibold">Restricted</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Recently Deleted is only available to super admins.
        </p>
        <Button asChild className="mt-5" variant="outline">
          <Link to="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    );
  }

  const purging = purgeFolder.isPending || purgeFile.isPending;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Recently Deleted</h1>
        <p className="text-sm text-muted-foreground">
          Deleted folders and files stay here until a super admin restores or permanently deletes
          them. Restoring a folder also restores everything that was inside it.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Folders
        </h2>
        <div className="glass-card overflow-hidden rounded-2xl">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Folder</TableHead>
                <TableHead className="hidden sm:table-cell">Deleted</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {foldersLoading && (
                <TableRow>
                  <TableCell colSpan={3} className="py-10 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              )}
              {!foldersLoading && (deletedFolders ?? []).length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={3}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    No deleted folders.
                  </TableCell>
                </TableRow>
              )}
              {(deletedFolders ?? []).map((folder) => {
                const parentName = parentNameOf(folder);
                return (
                  <TableRow key={folder.id}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        <FolderClosed className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0">
                          <span className="flex items-center gap-2">
                            <span className="truncate">{folder.name}</span>
                            <Badge variant="secondary">{folder.department}</Badge>
                          </span>
                          {parentName && (
                            <span className="block truncate text-xs font-normal text-muted-foreground">
                              Inside &quot;{parentName}&quot;
                            </span>
                          )}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-muted-foreground">
                      {folder.deleted_at ? formatDate(folder.deleted_at) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => restoreFolderMutation.mutate(folder)}
                          disabled={restoreFolderMutation.isPending}
                        >
                          <RotateCcw className="mr-2 h-4 w-4" />
                          Restore
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setPurgeTarget({ kind: "folder", folder })}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                          <span className="sr-only">Delete forever</span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Files
        </h2>
        <div className="glass-card overflow-hidden rounded-2xl">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File name</TableHead>
                <TableHead className="hidden sm:table-cell">From folder</TableHead>
                <TableHead className="hidden md:table-cell">Deleted</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filesLoading && (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              )}
              {!filesLoading && (deletedFiles ?? []).length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    No deleted files.
                  </TableCell>
                </TableRow>
              )}
              {(deletedFiles ?? []).map((file) => (
                <TableRow key={file.id}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{file.name}</span>
                    </span>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-muted-foreground">
                    {folderNameOf(file.folder_id)}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-muted-foreground">
                    {file.deleted_at ? formatDate(file.deleted_at) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => restoreFileMutation.mutate(file)}
                        disabled={restoreFileMutation.isPending}
                      >
                        <RotateCcw className="mr-2 h-4 w-4" />
                        Restore
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPurgeTarget({ kind: "file", file })}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                        <span className="sr-only">Delete forever</span>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <Dialog open={!!purgeTarget} onOpenChange={(open) => !open && setPurgeTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete forever</DialogTitle>
            <DialogDescription>
              {purgeTarget?.kind === "folder"
                ? `"${purgeTarget.folder.name}" and everything inside it will be permanently deleted. This cannot be undone.`
                : purgeTarget?.kind === "file"
                  ? `"${purgeTarget.file.name}" will be permanently deleted. This cannot be undone.`
                  : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPurgeTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={purging} onClick={confirmPurge}>
              Delete forever
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
