import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ClipboardPaste,
  Copy,
  Download,
  FileText,
  FolderClosed,
  FolderPlus,
  Loader2,
  Lock,
  Search,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { FolderCardMenu } from "@/components/portal/folder-card-menu";
import { FileRowMenu } from "@/components/portal/file-row-menu";
import { FilePreviewDialog } from "@/components/portal/file-preview-dialog";
import { ViewToggle } from "@/components/portal/view-toggle";
import { useViewMode } from "@/hooks/use-view-mode";
import { clearClipboard, setClipboard, useClipboard } from "@/lib/clipboard";
import {
  canRenameFolder,
  canWrite,
  childrenOf,
  copyFilesToFolder,
  createSubfolder,
  softDeleteFile,
  softDeleteFiles,
  softDeleteFolder,
  downloadFile,
  downloadFiles,
  fetchAllFolders,
  fetchFiles,
  fetchProfile,
  formatBytes,
  formatDate,
  moveFilesToFolder,
  pathOf,
  renameFolderRow,
  uploadFile,
  type Folder,
  type PortalFile,
} from "@/lib/portal";

interface FolderBrowserSearch {
  /** Nested sub-folder id to jump straight into — client-side browsing state otherwise isn't part of the URL at all. */
  open?: string;
  /** Pre-fills this folder's own file search box. */
  q?: string;
}

type FileSortKey = "name" | "size" | "date";

export const Route = createFileRoute("/_authenticated/folders/$slug")({
  // Both optional and both left out entirely on a plain navigation, so
  // existing <Link>/navigate calls elsewhere in the app don't need to
  // change — only the portal search box (portal-search.tsx) sets them.
  validateSearch: (search: Record<string, unknown>): FolderBrowserSearch => {
    const result: FolderBrowserSearch = {};
    if (typeof search["open"] === "string") result.open = search["open"];
    if (typeof search["q"] === "string") result.q = search["q"];
    return result;
  },
  head: () => ({
    meta: [
      { title: "Files | Pacific Horizon Tek Portal" },
      {
        name: "description",
        content:
          "Browse, upload and download department documents in the Pacific Horizon Tek secure portal.",
      },
      { property: "og:title", content: "Files | Pacific Horizon Tek Portal" },
      {
        property: "og:description",
        content: "Secure department file browser for Pacific Horizon Tek staff.",
      },
    ],
  }),
  component: FolderBrowser,
});

function FolderBrowser() {
  const { slug } = useParams({ from: "/_authenticated/folders/$slug" });
  const search = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  // Seeded from the `open` search param when arriving via the portal search
  // box (see portal-search.tsx); plain navigation here leaves it undefined
  // and this behaves exactly as before.
  const [currentId, setCurrentId] = useState<string | null>(() => search.open ?? null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [previewFile, setPreviewFile] = useState<PortalFile | null>(null);
  const [viewMode, setViewMode] = useViewMode();
  // Same idea via the `q` param, pre-filling this folder's own file search.
  const [fileQuery, setFileQuery] = useState(() => search.q ?? "");
  // File-list column sort. Defaults to newest-first, matching fetchFiles'
  // own default order — so nothing changes visually until a header is clicked.
  const [sortBy, setSortBy] = useState<FileSortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  // Files checked for the bulk download/delete bar. Keyed by id rather than
  // the search-filtered list, so a selection survives typing into the
  // per-folder search box.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const { data: allFolders, isLoading: folderLoading } = useQuery({
    queryKey: ["folders", "all"],
    queryFn: fetchAllFolders,
  });

  const folders: Folder[] = allFolders ?? [];
  const folder = folders.find((f) => f.slug === slug) ?? null;

  // The folder currently being browsed — the root, or the deepest sub-folder open.
  const activeFolder: Folder | null =
    (currentId ? folders.find((f) => f.id === currentId) : folder) ?? folder;

  const trail = pathOf(folders, activeFolder?.id ?? null);
  const visibleSubfolders = activeFolder ? childrenOf(folders, activeFolder.id) : [];

  // Resets the open sub-folder when the route's slug actually changes to a
  // different top-level folder. Compares against the previous slug rather
  // than using a one-shot "first run" flag: this app's client entry renders
  // inside React StrictMode, which intentionally invokes effects twice on
  // mount in development, and a one-shot flag would treat that second
  // invocation as "a change" and wipe out a deep-linked `open` param before
  // it's ever seen. Comparing values instead makes the guard a no-op no
  // matter how many times it happens to run with the same slug.
  const prevSlugRef = useRef(slug);
  useEffect(() => {
    if (prevSlugRef.current === slug) return;
    prevSlugRef.current = slug;
    setCurrentId(null);
  }, [slug]);

  // If the open sub-folder disappeared (deleted elsewhere), fall back to the root.
  useEffect(() => {
    if (currentId && allFolders && !folders.some((f) => f.id === currentId)) {
      setCurrentId(null);
    }
  }, [currentId, allFolders, folders]);

  const { data: files, isLoading: filesLoading } = useQuery({
    queryKey: ["files", activeFolder?.id],
    queryFn: () => fetchFiles(activeFolder!.id),
    enabled: !!activeFolder?.id,
  });

  // Clears a stale search when moving to a different folder, so its files
  // aren't hidden behind text that was typed for somewhere else. Compares
  // against the previously-resolved folder id rather than a one-shot flag
  // (same StrictMode reasoning as the slug effect above — and the case that
  // actually matters here, since the portal search box already warms the
  // folders cache before a click, so `activeFolder` is often resolved
  // synchronously on the very first render, not after a loading delay). The
  // very first resolution must not count as a change, or it would wipe out
  // a `q` param deep-linked from the portal search box before it's ever seen.
  const prevActiveFolderIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!activeFolder?.id) return;
    if (prevActiveFolderIdRef.current === undefined) {
      prevActiveFolderIdRef.current = activeFolder.id;
      return;
    }
    if (prevActiveFolderIdRef.current === activeFolder.id) return;
    prevActiveFolderIdRef.current = activeFolder.id;
    setFileQuery("");
    setSelectedIds(new Set());
  }, [activeFolder?.id]);

  // Files belong to the active folder row itself — no client-side placement.
  const visibleFiles: PortalFile[] = files ?? [];
  const filteredFiles: PortalFile[] = fileQuery.trim()
    ? visibleFiles.filter((file) =>
        file.name.toLowerCase().includes(fileQuery.trim().toLowerCase()),
      )
    : visibleFiles;

  // Clicking an already-active column flips direction; switching to a new
  // column picks whichever direction is most useful first (A-Z for name,
  // largest/newest first for size and date).
  function toggleSort(key: FileSortKey) {
    if (sortBy === key) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(key);
    setSortDir(key === "name" ? "asc" : "desc");
  }

  const sortedFiles: PortalFile[] = [...filteredFiles].sort((a, b) => {
    const cmp =
      sortBy === "name"
        ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
        : sortBy === "size"
          ? a.size - b.size
          : new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    return sortDir === "asc" ? cmp : -cmp;
  });

  // Selection tracks ids so it survives re-sorting; "select all" only ever
  // acts on the currently filtered/sorted rows the user can actually see.
  const selectedFiles: PortalFile[] = visibleFiles.filter((file) => selectedIds.has(file.id));
  const allSortedSelected =
    sortedFiles.length > 0 && sortedFiles.every((file) => selectedIds.has(file.id));
  const someSortedSelected = sortedFiles.some((file) => selectedIds.has(file.id));
  const selectAllState: boolean | "indeterminate" = allSortedSelected
    ? true
    : someSortedSelected
      ? "indeterminate"
      : false;

  function toggleFileSelected(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleSelectAll(checked: boolean) {
    setSelectedIds(checked ? new Set(sortedFiles.map((file) => file.id)) : new Set());
  }

  // Puts the selection on the same clipboard the per-file "Copy" menu item
  // uses, so pasting several files into another folder is just the existing
  // paste flow with more than one file riding along.
  function handleBulkCopy() {
    setClipboard({
      action: "copy",
      files: selectedFiles,
      sourceFolderId: activeFolder!.id,
      sourceFolderName: activeFolder!.name,
    });
    toast.success(
      `${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"} copied — open a folder to paste`,
    );
    setSelectedIds(new Set());
  }

  const writable = canWrite(profile ?? null, activeFolder);

  const isAdmin = profile?.role === "super_admin";

  const upload = useMutation({
    mutationFn: async (fileList: File[]) => {
      // Uploads target the exact folder row the user is standing in.
      const destination = activeFolder;
      if (!destination) throw new Error("Destination folder unavailable");
      for (const file of fileList) {
        setProgress(5);
        await uploadFile(destination, file, profile!.id, setProgress);
      }
    },
    onSuccess: () => {
      toast.success("Upload complete");
      queryClient.invalidateQueries({ queryKey: ["files", activeFolder?.id] });
      queryClient.invalidateQueries({ queryKey: ["folder-counts"] });
    },
    onError: (error: Error) => toast.error(error.message || "Upload failed"),
    onSettled: () => setTimeout(() => setProgress(null), 600),
  });

  const remove = useMutation({
    mutationFn: (file: PortalFile) => {
      if (!profile) throw new Error("Your session has expired — sign in again");
      return softDeleteFile(file, profile.id);
    },
    onSuccess: () => {
      toast.success("File moved to Recently Deleted");
      queryClient.invalidateQueries({ queryKey: ["files", activeFolder?.id] });
      queryClient.invalidateQueries({ queryKey: ["folder-counts"] });
    },
    onError: (error: Error) => toast.error(error.message || "Delete failed"),
  });

  const bulkDownload = useMutation({
    mutationFn: (targets: PortalFile[]) => downloadFiles(targets),
    onSuccess: (result) => {
      if (result.failed.length === 0) {
        toast.success(`Downloading ${result.succeeded} file${result.succeeded === 1 ? "" : "s"}`);
      } else {
        toast.error(
          `Downloaded ${result.succeeded} of ${result.succeeded + result.failed.length} files — the rest failed`,
        );
      }
    },
    onError: () => toast.error("Bulk download failed"),
  });

  const bulkRemove = useMutation({
    mutationFn: (targets: PortalFile[]) => {
      if (!profile) throw new Error("Your session has expired — sign in again");
      return softDeleteFiles(targets, profile.id);
    },
    onSuccess: (result, targets) => {
      queryClient.invalidateQueries({ queryKey: ["files", activeFolder?.id] });
      queryClient.invalidateQueries({ queryKey: ["folder-counts"] });
      setSelectedIds(new Set());
      if (result.failed.length === 0) {
        toast.success(
          `${result.succeeded} file${result.succeeded === 1 ? "" : "s"} moved to Recently Deleted`,
        );
      } else {
        toast.error(`Deleted ${result.succeeded} of ${targets.length} files — the rest failed`);
      }
    },
    onError: (error: Error) => toast.error(error.message || "Bulk delete failed"),
  });

  const clipboard = useClipboard();

  const paste = useMutation({
    mutationFn: async () => {
      if (!clipboard) throw new Error("Nothing on the clipboard");
      if (!activeFolder) throw new Error("Destination folder unavailable");
      if (!profile) throw new Error("Your session has expired — sign in again");
      const result =
        clipboard.action === "copy"
          ? await copyFilesToFolder(clipboard.files, activeFolder, profile.id)
          : await moveFilesToFolder(clipboard.files, activeFolder);
      return {
        action: clipboard.action,
        sourceFolderId: clipboard.sourceFolderId,
        ...result,
      };
    },
    onSuccess: (result) => {
      clearClipboard();
      const verb = result.action === "cut" ? "moved" : "copied";
      const noun = result.succeeded === 1 ? "File" : `${result.succeeded} files`;
      if (result.failed.length === 0) {
        toast.success(`${noun} ${verb}`);
      } else {
        const total = result.succeeded + result.failed.length;
        toast.error(
          `${result.action === "cut" ? "Moved" : "Copied"} ${result.succeeded} of ${total} files — the rest failed`,
        );
      }
      queryClient.invalidateQueries({ queryKey: ["files"] });
      if (result?.sourceFolderId) {
        queryClient.invalidateQueries({
          queryKey: ["files", result.sourceFolderId],
        });
      }
      queryClient.invalidateQueries({ queryKey: ["folder-counts"] });
    },
    onError: (error: Error) => toast.error(error.message || "Could not complete that action"),
  });

  const removeFolder = useMutation({
    mutationFn: async () => {
      if (!folder) throw new Error("Folder unavailable");
      if (!profile) throw new Error("Your session has expired — sign in again");
      await softDeleteFolder(folder, folders, profile.id);
    },
    onSuccess: () => {
      toast.success("Folder moved to Recently Deleted");
      queryClient.invalidateQueries({ queryKey: ["folders"] });
      queryClient.invalidateQueries({ queryKey: ["folder-counts"] });
      navigate({ to: "/dashboard", replace: true });
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

  const removeSubfolder = useMutation({
    mutationFn: (target: Folder) => {
      if (!profile) throw new Error("Your session has expired — sign in again");
      return softDeleteFolder(target, folders, profile.id);
    },
    onSuccess: () => {
      toast.success("Folder moved to Recently Deleted");
      queryClient.invalidateQueries({ queryKey: ["folders"] });
      queryClient.invalidateQueries({ queryKey: ["folder-counts"] });
      queryClient.invalidateQueries({ queryKey: ["files"] });
    },
    onError: (error: Error) => toast.error(error.message || "Could not delete this folder"),
  });

  const createFolder = useMutation({
    mutationFn: async (name: string) => {
      if (!activeFolder) throw new Error("Folder unavailable");
      if (!profile) throw new Error("Your session has expired — sign in again");
      return createSubfolder(activeFolder, name, profile);
    },
    onSuccess: (created) => {
      setNewName("");
      setDialogOpen(false);
      toast.success(`Folder "${created.name}" created`);
      queryClient.invalidateQueries({ queryKey: ["folders"] });
    },
    onError: (error: Error) => toast.error(error.message || "Could not create this folder"),
  });

  async function handleDownload(file: PortalFile) {
    try {
      await downloadFile(file);
    } catch {
      toast.error("You do not have permission to download this file");
    }
  }

  function handleCreateFolder() {
    const name = newName.trim();
    if (!name) {
      toast.error("Enter a folder name");
      return;
    }
    createFolder.mutate(name);
  }

  if (folderLoading) {
    return <Skeleton className="mx-auto h-64 w-full max-w-6xl rounded-2xl" />;
  }

  if (!folder) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-dashed border-border p-10 text-center">
        <Lock className="mx-auto h-6 w-6 text-muted-foreground" />
        <h2 className="mt-3 font-semibold">Folder unavailable</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          This folder does not exist or your role does not permit access.
        </p>
        <Button asChild className="mt-5" variant="outline">
          <Link to="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    );
  }

  const folderName = folder.name;
  const canRenameRoot = canRenameFolder(profile ?? null, folder);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/dashboard">Home</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            {trail.length === 0 ? (
              <BreadcrumbPage>{folderName}</BreadcrumbPage>
            ) : (
              <BreadcrumbLink asChild>
                <button type="button" onClick={() => setCurrentId(null)}>
                  {folderName}
                </button>
              </BreadcrumbLink>
            )}
          </BreadcrumbItem>
          {trail.map((crumb, i) => (
            <span key={crumb.id} className="flex items-center gap-1.5">
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {i === trail.length - 1 ? (
                  <BreadcrumbPage>{crumb.name}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <button type="button" onClick={() => setCurrentId(crumb.id)}>
                      {crumb.name}
                    </button>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </span>
          ))}
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {trail.at(-1)?.name ?? folderName}
          </h1>
          <p className="text-sm text-muted-foreground">
            {trail.length ? `Inside ${folderName}` : folder.description}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={writable ? "default" : "secondary"}>
            {writable ? "Read & Upload" : "Read only"}
          </Badge>
          <ViewToggle value={viewMode} onChange={setViewMode} />
          {trail.length === 0 && canRenameRoot && (
            <FolderCardMenu
              name={folderName}
              onRename={(next) => renameFolder.mutate({ target: folder, name: next })}

              {...(isAdmin
                ? {
                    onDelete: () => removeFolder.mutateAsync(),
                    deleting: removeFolder.isPending,
                    deleteDescription: `"${folderName}" and all files stored inside it will be moved to Recently Deleted. A super admin can restore it or delete it permanently from there.`,
                  }
                : {})}
            />
          )}
        </div>
      </div>

      {clipboard &&
        (() => {
          const destinationName = trail.at(-1)?.name ?? folderName;
          const alreadyHere =
            clipboard.action === "cut" && clipboard.sourceFolderId === activeFolder?.id;
          const clipboardLabel =
            clipboard.files.length === 1
              ? clipboard.files[0]!.name
              : `${clipboard.files.length} files`;
          const actionLabel =
            clipboard.files.length === 1
              ? clipboard.action === "cut"
                ? `Move to ${destinationName}`
                : `Paste into ${destinationName}`
              : clipboard.action === "cut"
                ? `Move ${clipboard.files.length} files to ${destinationName}`
                : `Paste ${clipboard.files.length} files into ${destinationName}`;

          return (
            <div className="glass-card flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{clipboardLabel}</span> ready to{" "}
                {clipboard.action === "cut" ? "move" : "copy"} from {clipboard.sourceFolderName}
                {alreadyHere && <span className="ml-1 text-xs">— already in this folder.</span>}
                {!writable && (
                  <span className="ml-1 text-xs">— you don't have upload rights here.</span>
                )}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => clearClipboard()}>
                  <X className="mr-2 h-4 w-4" />
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={!writable || paste.isPending || alreadyHere}
                  onClick={() => paste.mutate()}
                >
                  {paste.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ClipboardPaste className="mr-2 h-4 w-4" />
                  )}
                  {actionLabel}
                </Button>
              </div>
            </div>
          );
        })()}

      {writable ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const dropped = Array.from(e.dataTransfer.files);
            if (dropped.length) upload.mutate(dropped);
          }}
          className={`glass-card rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
            dragging ? "border-primary bg-accent/40" : "border-border"
          }`}
        >
          <UploadCloud className="mx-auto h-7 w-7 text-primary" />
          <p className="mt-3 text-sm font-medium">Drag and drop files here</p>
          <p className="text-xs text-muted-foreground">
            or browse from your device — files are stored privately
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              if (picked.length) upload.mutate(picked);
              e.target.value = "";
            }}
          />
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Button onClick={() => inputRef.current?.click()} disabled={upload.isPending}>
              {upload.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <UploadCloud className="mr-2 h-4 w-4" />
              )}
              Upload file
            </Button>
            <Button variant="outline" onClick={() => setDialogOpen(true)}>
              <FolderPlus className="mr-2 h-4 w-4" />
              New Folder
            </Button>
          </div>
          {progress !== null && <Progress value={progress} className="mx-auto mt-4 h-2 max-w-sm" />}
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          <Lock className="h-4 w-4" />
          You have read-only access to this folder.
        </div>
      )}

      {visibleSubfolders.length > 0 &&
        (viewMode === "grid" ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleSubfolders.map((sub) => (
              <div
                key={sub.id}
                role="button"
                tabIndex={0}
                onClick={() => setCurrentId(sub.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") setCurrentId(sub.id);
                }}
                className="glass-card flex cursor-pointer flex-col rounded-2xl p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-elevated)]"
              >
                <div className="flex items-start justify-between">
                  <span className="brand-gradient inline-flex h-10 w-10 items-center justify-center rounded-xl text-gradient-brand-foreground">
                    <FolderClosed className="h-5 w-5" />
                  </span>
                  {canRenameFolder(profile ?? null, sub) && (
                    <FolderCardMenu
                      name={sub.name}
                      onRename={(next) => renameFolder.mutate({ target: sub, name: next })}
                      onDelete={async () => {
                        await removeSubfolder.mutateAsync(sub);
                        if (currentId === sub.id) setCurrentId(sub.parent_id);
                      }}
                      deleting={removeSubfolder.isPending}
                      deleteDescription={`"${sub.name}", its sub-folders and every file inside will be moved to Recently Deleted. A super admin can restore it or delete it permanently from there.`}
                    />
                  )}
                </div>
                <h3 className="mt-3 font-semibold tracking-tight">{sub.name}</h3>
                <p className="text-xs text-muted-foreground">
                  {childrenOf(folders, sub.id).length} sub-folders
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="glass-card overflow-hidden rounded-2xl">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sub-folder</TableHead>
                  <TableHead className="hidden sm:table-cell">Sub-folders</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleSubfolders.map((sub) => (
                  <TableRow
                    key={sub.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setCurrentId(sub.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") setCurrentId(sub.id);
                    }}
                    className="cursor-pointer"
                  >
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-3">
                        <span className="brand-gradient inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gradient-brand-foreground">
                          <FolderClosed className="h-4 w-4" />
                        </span>
                        <span className="truncate">{sub.name}</span>
                      </span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-muted-foreground">
                      {childrenOf(folders, sub.id).length} sub-folders
                    </TableCell>
                    <TableCell className="text-right">
                      {canRenameFolder(profile ?? null, sub) && (
                        <FolderCardMenu
                          name={sub.name}
                          onRename={(next) => renameFolder.mutate({ target: sub, name: next })}
                          onDelete={async () => {
                            await removeSubfolder.mutateAsync(sub);
                            if (currentId === sub.id) setCurrentId(sub.parent_id);
                          }}
                          deleting={removeSubfolder.isPending}
                          deleteDescription={`"${sub.name}", its sub-folders and every file inside will be moved to Recently Deleted. A super admin can restore it or delete it permanently from there.`}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ))}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create new folder</DialogTitle>
            <DialogDescription>
              The folder will be added inside{" "}
              <span className="font-medium">{trail.at(-1)?.name ?? folderName}</span>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="folder-name">Folder Name</Label>
            <Input
              id="folder-name"
              value={newName}
              autoFocus
              placeholder="e.g. 2026 Presentations"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFolder();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateFolder}>Create Folder</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {filesLoading ? (
        <div className="glass-card flex justify-center rounded-2xl p-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : visibleFiles.length === 0 ? (
        <p className="glass-card rounded-2xl p-12 text-center text-sm text-muted-foreground">
          No files in this folder yet.
        </p>
      ) : (
        <>
          {selectedFiles.length > 0 && (
            <div className="glass-card flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3">
              <p className="text-sm font-medium">
                {selectedFiles.length} file{selectedFiles.length === 1 ? "" : "s"} selected
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => bulkDownload.mutate(selectedFiles)}
                  disabled={bulkDownload.isPending}
                >
                  {bulkDownload.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  Download
                </Button>
                <Button variant="outline" size="sm" onClick={handleBulkCopy}>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy
                </Button>
                {isAdmin && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => bulkRemove.mutate(selectedFiles)}
                    disabled={bulkRemove.isPending}
                  >
                    {bulkRemove.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="mr-2 h-4 w-4 text-destructive" />
                    )}
                    Delete
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                  <X className="h-4 w-4" />
                  <span className="sr-only">Clear selection</span>
                </Button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={fileQuery}
                onChange={(e) => setFileQuery(e.target.value)}
                placeholder="Search files by name..."
                className="pl-9"
              />
            </div>
            {fileQuery.trim() && (
              <p className="text-xs text-muted-foreground">
                {filteredFiles.length} of {visibleFiles.length} files
              </p>
            )}
          </div>

          {filteredFiles.length === 0 ? (
            <p className="glass-card rounded-2xl p-12 text-center text-sm text-muted-foreground">
              No files match &quot;{fileQuery.trim()}&quot;.
            </p>
          ) : viewMode === "grid" ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {sortedFiles.map((file) => {
                const clipped = clipboard?.files.some((f) => f.id === file.id) ?? false;
                return (
                  <div
                    key={file.id}
                    title="Double-click to preview"
                    onDoubleClick={() => setPreviewFile(file)}
                    className={`glass-card flex cursor-pointer flex-col rounded-2xl p-4 transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-elevated)] ${clipped ? "bg-accent/40" : ""}`}
                  >
                    <div className="flex items-start justify-between">
                      <div
                        className="flex items-center gap-2"
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => e.stopPropagation()}
                      >
                        <Checkbox
                          checked={selectedIds.has(file.id)}
                          onCheckedChange={(checked) => toggleFileSelected(file.id, !!checked)}
                          aria-label={`Select ${file.name}`}
                        />
                        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                          <FileText className="h-5 w-5" />
                        </span>
                      </div>
                      <FileRowMenu
                        canCut={writable}
                        onPreview={() => setPreviewFile(file)}
                        onCut={() => {
                          setClipboard({
                            action: "cut",
                            files: [file],
                            sourceFolderId: activeFolder!.id,
                            sourceFolderName: activeFolder!.name,
                          });
                          toast.success(`"${file.name}" cut — open a folder to move it`);
                        }}
                        onCopy={() => {
                          setClipboard({
                            action: "copy",
                            files: [file],
                            sourceFolderId: activeFolder!.id,
                            sourceFolderName: activeFolder!.name,
                          });
                          toast.success(`"${file.name}" copied — open a folder to paste`);
                        }}
                      />
                    </div>
                    <p
                      className={`mt-3 truncate text-sm font-medium ${clipboard?.action === "cut" && clipped ? "opacity-60" : ""}`}
                      title={file.name}
                    >
                      {file.name}
                    </p>
                    <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      {formatBytes(file.size)} · {formatDate(file.created_at)}
                      {clipped && (
                        <Badge variant="secondary" className="shrink-0 capitalize">
                          {clipboard?.action}
                        </Badge>
                      )}
                    </p>
                    <div className="mt-3 flex items-center justify-between border-t border-border pt-2">
                      <Button variant="ghost" size="sm" onClick={() => handleDownload(file)}>
                        <Download className="mr-2 h-4 w-4" />
                        Download
                      </Button>
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => remove.mutate(file)}
                          disabled={remove.isPending}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                          <span className="sr-only">Delete</span>
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="glass-card overflow-hidden rounded-2xl">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={selectAllState}
                        onCheckedChange={(checked) => toggleSelectAll(!!checked)}
                        aria-label="Select all files"
                      />
                    </TableHead>
                    <TableHead>
                      <SortHeaderButton
                        label="File name"
                        active={sortBy === "name"}
                        dir={sortDir}
                        onClick={() => toggleSort("name")}
                      />
                    </TableHead>
                    <TableHead className="hidden sm:table-cell">
                      <SortHeaderButton
                        label="Size"
                        active={sortBy === "size"}
                        dir={sortDir}
                        onClick={() => toggleSort("size")}
                      />
                    </TableHead>
                    <TableHead className="hidden md:table-cell">
                      <SortHeaderButton
                        label="Date uploaded"
                        active={sortBy === "date"}
                        dir={sortDir}
                        onClick={() => toggleSort("date")}
                      />
                    </TableHead>
                    <TableHead className="hidden lg:table-cell">Uploaded by</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedFiles.map((file) => {
                    const clipped = clipboard?.files.some((f) => f.id === file.id) ?? false;
                    return (
                      <TableRow
                        key={file.id}
                        title="Double-click to preview"
                        onDoubleClick={() => setPreviewFile(file)}
                        className={`cursor-pointer ${clipped ? "bg-accent/40" : ""}`}
                      >
                        <TableCell
                          onClick={(e) => e.stopPropagation()}
                          onDoubleClick={(e) => e.stopPropagation()}
                        >
                          <Checkbox
                            checked={selectedIds.has(file.id)}
                            onCheckedChange={(checked) => toggleFileSelected(file.id, !!checked)}
                            aria-label={`Select ${file.name}`}
                          />
                        </TableCell>
                        <TableCell className="font-medium">
                          <span className="flex items-center gap-2">
                            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span
                              className={`truncate ${clipboard?.action === "cut" && clipped ? "opacity-60" : ""}`}
                            >
                              {file.name}
                            </span>
                            {clipped && (
                              <Badge variant="secondary" className="shrink-0 capitalize">
                                {clipboard?.action}
                              </Badge>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-muted-foreground">
                          {formatBytes(file.size)}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-muted-foreground">
                          {formatDate(file.created_at)}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-muted-foreground">
                          {file.uploader_email}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="sm" onClick={() => handleDownload(file)}>
                              <Download className="h-4 w-4" />
                              <span className="sr-only">Download</span>
                            </Button>
                            {isAdmin && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => remove.mutate(file)}
                                disabled={remove.isPending}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                                <span className="sr-only">Delete</span>
                              </Button>
                            )}
                            <FileRowMenu
                              canCut={writable}
                              onPreview={() => setPreviewFile(file)}
                              onCut={() => {
                                setClipboard({
                                  action: "cut",
                                  files: [file],
                                  sourceFolderId: activeFolder!.id,
                                  sourceFolderName: activeFolder!.name,
                                });
                                toast.success(`"${file.name}" cut — open a folder to move it`);
                              }}
                              onCopy={() => {
                                setClipboard({
                                  action: "copy",
                                  files: [file],
                                  sourceFolderId: activeFolder!.id,
                                  sourceFolderName: activeFolder!.name,
                                });
                                toast.success(`"${file.name}" copied — open a folder to paste`);
                              }}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}

      <FilePreviewDialog
        file={previewFile}
        onOpenChange={(open) => !open && setPreviewFile(null)}
        onDownload={handleDownload}
      />
    </div>
  );
}

/** A clickable table-header label with a sort-direction indicator; the icon
 * is a neutral up/down glyph until this column is the active sort. */
function SortHeaderButton({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-left hover:text-foreground"
    >
      {label}
      {active ? (
        dir === "asc" ? (
          <ArrowUp className="h-3.5 w-3.5" />
        ) : (
          <ArrowDown className="h-3.5 w-3.5" />
        )
      ) : (
        <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/50" />
      )}
    </button>
  );
}
