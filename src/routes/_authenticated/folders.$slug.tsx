import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  ClipboardPaste,
  Download,
  FileText,
  FolderClosed,
  FolderPlus,
  Loader2,
  Lock,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  addMockSubfolder,
  canRenameFolder,
  childrenOf,
  pathOf,
  renameMockSubfolder,
  renameRootFolder,
  useMockRootNames,
  useMockSubfolders,
} from "@/lib/mock-subfolders";
import { FolderCardMenu } from "@/components/portal/folder-card-menu";
import { FileRowMenu } from "@/components/portal/file-row-menu";
import { clearClipboard, setClipboard, useClipboard } from "@/lib/clipboard";
import {
  canWrite,
  copyFileToFolder,
  deleteFile,
  downloadFile,
  fetchFiles,
  fetchFolderBySlug,
  fetchProfile,
  formatBytes,
  formatDate,
  moveFileToFolder,
  uploadFile,
  type PortalFile,
} from "@/lib/portal";



export const Route = createFileRoute("/_authenticated/folders/$slug")({
  head: () => ({
    meta: [
      { title: "Files | Pacific Horizon Care Portal" },
      {
        name: "description",
        content:
          "Browse, upload and download department documents in the Pacific Horizon Care secure portal.",
      },
      { property: "og:title", content: "Files | Pacific Horizon Care Portal" },
      {
        property: "og:description",
        content: "Secure department file browser for Pacific Horizon Care staff.",
      },
    ],
  }),
  component: FolderBrowser,
});

function FolderBrowser() {
  const { slug } = useParams({ from: "/_authenticated/folders/$slug" });
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");

  const subfolders = useMockSubfolders(slug);
  const rootNames = useMockRootNames();
  const trail = pathOf(subfolders, currentId);
  const visibleSubfolders = childrenOf(subfolders, currentId);


  useEffect(() => {
    setCurrentId(null);
  }, [slug]);


  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const { data: folder, isLoading: folderLoading } = useQuery({
    queryKey: ["folder", slug],
    queryFn: () => fetchFolderBySlug(slug),
  });
  const { data: files, isLoading: filesLoading } = useQuery({
    queryKey: ["files", folder?.id],
    queryFn: () => fetchFiles(folder!.id),
    enabled: !!folder?.id,
  });

  // Mock sub-folders have no files yet — real files live at the folder root.
  const visibleFiles: PortalFile[] = currentId === null ? (files ?? []) : [];

  const writable = canWrite(profile ?? null, folder ?? null);

  const isAdmin = profile?.role === "super_admin";

  const upload = useMutation({
    mutationFn: async (fileList: File[]) => {
      for (const file of fileList) {
        setProgress(5);
        await uploadFile(folder!, file, profile!.id, setProgress);
      }
    },
    onSuccess: () => {
      toast.success("Upload complete");
      queryClient.invalidateQueries({ queryKey: ["files", folder?.id] });
      queryClient.invalidateQueries({ queryKey: ["folder-counts"] });
    },
    onError: (error: Error) => toast.error(error.message || "Upload failed"),
    onSettled: () => setTimeout(() => setProgress(null), 600),
  });

  const remove = useMutation({
    mutationFn: (file: PortalFile) => deleteFile(file),
    onSuccess: () => {
      toast.success("File deleted");
      queryClient.invalidateQueries({ queryKey: ["files", folder?.id] });
      queryClient.invalidateQueries({ queryKey: ["folder-counts"] });
    },
    onError: (error: Error) => toast.error(error.message || "Delete failed"),
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
    addMockSubfolder(slug, name, currentId, profile?.email ?? null);
    setNewName("");
    setDialogOpen(false);
    toast.success(`Folder "${name}" created`);
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

  const folderName = rootNames[folder.slug] ?? folder.name;
  const canRenameRoot = canRenameFolder(profile ?? null, null);

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
        <div className="flex items-center gap-1">
          <Badge variant={writable ? "default" : "secondary"}>
            {writable ? "Read & Upload" : "Read only"}
          </Badge>
          {trail.length === 0 && canRenameRoot && (
            <FolderCardMenu
              name={folderName}
              onRename={(next) => renameRootFolder(folder.slug, next)}
            />
          )}
        </div>
      </div>


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
            <Button
              onClick={() => inputRef.current?.click()}
              disabled={upload.isPending}
            >
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
          {progress !== null && (
            <Progress value={progress} className="mx-auto mt-4 h-2 max-w-sm" />
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          <Lock className="h-4 w-4" />
          You have read-only access to this folder.
        </div>
      )}

      {visibleSubfolders.length > 0 && (
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
                <span className="brand-gradient inline-flex h-10 w-10 items-center justify-center rounded-xl text-primary-foreground">
                  <FolderClosed className="h-5 w-5" />
                </span>
                {canRenameFolder(profile ?? null, sub.ownerEmail) && (
                  <FolderCardMenu
                    name={sub.name}
                    onRename={(next) => renameMockSubfolder(slug, sub.id, next)}
                  />
                )}
              </div>
              <h3 className="mt-3 font-semibold tracking-tight">{sub.name}</h3>
              <p className="text-xs text-muted-foreground">
                {childrenOf(subfolders, sub.id).length} sub-folders
              </p>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create new folder</DialogTitle>
            <DialogDescription>
              The folder will be added inside{" "}
              <span className="font-medium">
                {trail.at(-1)?.name ?? folderName}
              </span>
              .
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



      <div className="glass-card overflow-hidden rounded-2xl">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File name</TableHead>
              <TableHead className="hidden sm:table-cell">Size</TableHead>
              <TableHead className="hidden md:table-cell">Date uploaded</TableHead>
              <TableHead className="hidden lg:table-cell">Uploaded by</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filesLoading && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                </TableCell>
              </TableRow>
            )}
            {!filesLoading && visibleFiles.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-12 text-center text-sm text-muted-foreground"
                >
                  No files in this folder yet.
                </TableCell>
              </TableRow>
            )}
            {visibleFiles.map((file) => (
              <TableRow key={file.id}>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{file.name}</span>
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
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDownload(file)}
                    >
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
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
