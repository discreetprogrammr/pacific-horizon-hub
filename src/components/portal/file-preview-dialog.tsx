import { useEffect, useState } from "react";
import { Download, FileText, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createPreviewUrl, formatBytes, type PortalFile } from "@/lib/portal";

interface FilePreviewDialogProps {
  file: PortalFile | null;
  onOpenChange: (open: boolean) => void;
  onDownload: (file: PortalFile) => void;
}

export function FilePreviewDialog({ file, onOpenChange, onDownload }: FilePreviewDialogProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setUrl(null);
    setError(null);
    if (!file) return;
    createPreviewUrl(file)
      .then((signed) => {
        if (active) setUrl(signed);
      })
      .catch(() => {
        if (active) setError("You do not have permission to preview this file.");
      });
    return () => {
      active = false;
    };
  }, [file]);

  const mime = file?.mime_type ?? "";
  const isImage = mime.startsWith("image/");
  const isPdf = mime === "application/pdf";
  // HTML (and XHTML) is deliberately excluded from inline preview: it's the one
  // "text" type that can carry live script, and an iframe is the wrong place to
  // run content from a file someone else uploaded. See isHtml below.
  const isHtml = mime === "text/html" || mime === "application/xhtml+xml";
  const isText = (mime.startsWith("text/") || mime === "application/json") && !isHtml;
  const isAudio = mime.startsWith("audio/");
  const isVideo = mime.startsWith("video/");
  const canInline = isImage || isPdf || isText || isAudio || isVideo;

  return (
    <Dialog open={!!file} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate">{file?.name}</DialogTitle>
          <DialogDescription>
            {file ? `${formatBytes(file.size)} · ${mime || "Unknown type"}` : null}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-[240px] items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/40">
          {error ? (
            <p className="p-8 text-sm text-destructive">{error}</p>
          ) : !url ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          ) : isImage ? (
            <img
              src={url}
              alt={file?.name ?? "File preview"}
              className="max-h-[65vh] w-full object-contain"
            />
          ) : isVideo ? (
            <video src={url} controls className="max-h-[65vh] w-full" />
          ) : isAudio ? (
            <audio src={url} controls className="w-full p-6" />
          ) : isPdf ? (
            <iframe
              src={url}
              title={file?.name ?? "File preview"}
              className="h-[65vh] w-full bg-background"
              // No `sandbox` here on purpose: Chrome's built-in PDF viewer is
              // implemented as an internal extension, and Chromium refuses to
              // activate ANY extension inside a sandboxed iframe — tested this
              // directly, every sandbox token combination blanks the PDF, even
              // the most permissive one. PDFium already runs in its own
              // browser-level sandboxed process independent of this attribute,
              // and it can't execute arbitrary page script or navigate the tab
              // the way a real HTML document could — that's what isHtml below
              // guards against instead.
              referrerPolicy="no-referrer"
            />
          ) : canInline ? (
            <iframe
              src={url}
              title={file?.name ?? "File preview"}
              className="h-[65vh] w-full bg-background"
              // Empty sandbox: no script execution, no form submission, no
              // top-level navigation, no popups. Plain text/JSON render fine
              // under this — confirmed directly — so there's no tradeoff here.
              sandbox=""
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="p-10 text-center">
              <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">
                {isHtml
                  ? "HTML files can't be previewed inline for security reasons — download it to view."
                  : "This file type can't be previewed in the browser."}
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => url && window.open(url, "_blank", "noopener")}
            disabled={!url}
          >
            Open in new tab
          </Button>
          <Button variant="outline" onClick={() => file && onDownload(file)} disabled={!file}>
            <Download className="mr-2 h-4 w-4" />
            Download
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
