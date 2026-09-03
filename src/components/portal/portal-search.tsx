import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FileText, FolderClosed, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  fetchAllFolders,
  rootAncestorOf,
  searchFiles,
  type Folder,
  type PortalFile,
} from "@/lib/portal";

const MAX_RESULTS_PER_GROUP = 5;
const MIN_QUERY_LENGTH = 2;

/**
 * Portal-wide search: matches file and folder names across everything the
 * signed-in user can see. Folders come from the already-cached
 * ["folders", "all"] query (shared with the dashboard and folder browser,
 * so this rarely triggers its own fetch); files go through a dedicated
 * search that isn't scoped to one folder — the "Read permitted files" RLS
 * policy is what keeps results limited to what the caller can actually see.
 *
 * Clicking a result navigates straight to it: the root (department) folder
 * it lives under, with an `open` search param when the match is a nested
 * sub-folder so folders.$slug.tsx can jump straight there, and a `q` param
 * for a file match so the folder's own file search box opens pre-filled.
 */
export function PortalSearch() {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const { data: allFolders } = useQuery({
    queryKey: ["folders", "all"],
    queryFn: fetchAllFolders,
  });

  const canSearch = debouncedQuery.length >= MIN_QUERY_LENGTH;

  const folderMatches: Folder[] = useMemo(() => {
    if (!canSearch) return [];
    const q = debouncedQuery.toLowerCase();
    return (allFolders ?? [])
      .filter((folder) => folder.name.toLowerCase().includes(q))
      .slice(0, MAX_RESULTS_PER_GROUP);
  }, [allFolders, canSearch, debouncedQuery]);

  const { data: fileMatches = [] } = useQuery({
    queryKey: ["search-files", debouncedQuery],
    queryFn: () => searchFiles(debouncedQuery, MAX_RESULTS_PER_GROUP),
    enabled: canSearch,
  });

  const showDropdown = open && canSearch;
  const hasResults = folderMatches.length > 0 || fileMatches.length > 0;

  function reset() {
    setQuery("");
    setDebouncedQuery("");
    setOpen(false);
  }

  function goToFolder(folder: Folder) {
    const all = allFolders ?? [];
    const root = rootAncestorOf(all, folder.id) ?? folder;
    navigate({
      to: "/folders/$slug",
      params: { slug: root.slug },
      search: root.id === folder.id ? {} : { open: folder.id },
    });
    reset();
  }

  function goToFile(file: PortalFile) {
    const all = allFolders ?? [];
    const root = rootAncestorOf(all, file.folder_id);
    if (!root) return;
    navigate({
      to: "/folders/$slug",
      params: { slug: root.slug },
      search:
        root.id === file.folder_id ? { q: file.name } : { open: file.folder_id, q: file.name },
    });
    reset();
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-sm">
      <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.currentTarget.blur();
            setOpen(false);
          }
        }}
        placeholder="Search files and folders..."
        className="pl-9"
        aria-label="Search files and folders"
      />
      {showDropdown && (
        <div className="absolute top-full left-0 z-30 mt-2 w-full min-w-80 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-[var(--shadow-elevated)]">
          {!hasResults ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              No matches for &quot;{debouncedQuery}&quot;.
            </p>
          ) : (
            <div className="max-h-80 overflow-y-auto py-1">
              {folderMatches.length > 0 && (
                <div>
                  <p className="px-3 py-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Folders
                  </p>
                  {folderMatches.map((folder) => (
                    <button
                      key={folder.id}
                      type="button"
                      onClick={() => goToFolder(folder)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                    >
                      <FolderClosed className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{folder.name}</span>
                    </button>
                  ))}
                </div>
              )}
              {fileMatches.length > 0 && (
                <div>
                  <p className="px-3 py-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Files
                  </p>
                  {fileMatches.map((file) => (
                    <button
                      key={file.id}
                      type="button"
                      onClick={() => goToFile(file)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                    >
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{file.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
