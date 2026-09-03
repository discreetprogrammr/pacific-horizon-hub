import { LayoutGrid, List } from "lucide-react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ViewMode } from "@/hooks/use-view-mode";

interface ViewToggleProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

/** Grid/list switch for folder and file listings. Empty selections are ignored so one option always stays active. */
export function ViewToggle({ value, onChange }: ViewToggleProps) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next === "grid" || next === "list") onChange(next);
      }}
      className="shrink-0 rounded-lg border border-border bg-card p-0.5"
    >
      <ToggleGroupItem
        value="grid"
        size="sm"
        aria-label="Grid view"
        className="h-8 w-8 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground"
      >
        <LayoutGrid className="h-4 w-4" />
      </ToggleGroupItem>
      <ToggleGroupItem
        value="list"
        size="sm"
        aria-label="List view"
        className="h-8 w-8 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground"
      >
        <List className="h-4 w-4" />
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
