import { Check, Monitor, Moon, Sun, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Theme } from "@/hooks/use-theme";

interface ThemeToggleProps {
  value: Theme;
  onChange: (theme: Theme) => void;
}

const OPTIONS: { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

/** Light/dark/system theme switch. The trigger shows the active mode's icon; the menu marks the current choice. */
export function ThemeToggle({ value, onChange }: ThemeToggleProps) {
  const ActiveIcon = OPTIONS.find((option) => option.value === value)?.icon ?? Monitor;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Theme settings"
          className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
        >
          <ActiveIcon className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {OPTIONS.map(({ value: optionValue, label, icon: Icon }) => (
          <DropdownMenuItem key={optionValue} onSelect={() => onChange(optionValue)}>
            <Icon className="mr-2 h-4 w-4" />
            {label}
            {value === optionValue && <Check className="ml-auto h-4 w-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
