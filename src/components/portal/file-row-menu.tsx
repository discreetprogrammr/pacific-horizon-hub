import { Copy, MoreHorizontal, Scissors } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface FileRowMenuProps {
  canCut: boolean;
  onCut: () => void;
  onCopy: () => void;
}

export function FileRowMenu({ canCut, onCut, onCopy }: FileRowMenuProps) {
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
