import { Copy, Eye, MoreHorizontal, Scissors } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface FileRowMenuProps {
  canCut: boolean;
  onCut: () => void;
  onCopy: () => void;
  onPreview?: () => void;
}

export function FileRowMenu({ canCut, onCut, onCopy, onPreview }: FileRowMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label="File options"
          className="text-muted-foreground hover:text-foreground"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        {onPreview && (
          <>
            <DropdownMenuItem onSelect={onPreview}>
              <Eye className="mr-2 h-4 w-4" />
              Preview
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {canCut && (
          <DropdownMenuItem onSelect={onCut}>
            <Scissors className="mr-2 h-4 w-4" />
            Cut
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={onCopy}>
          <Copy className="mr-2 h-4 w-4" />
          Copy
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
