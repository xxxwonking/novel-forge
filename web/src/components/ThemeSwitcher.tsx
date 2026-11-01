import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import {
  getThemePreference,
  setThemePreference,
  subscribeTheme,
  type ThemePreference,
} from "../theme.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select.js";

export function ThemeSwitcher(): React.ReactElement {
  const theme = useSyncExternalStore(
    subscribeTheme,
    getThemePreference,
    () => "dark",
  );
  const Icon = theme === "system" ? Monitor : theme === "light" ? Sun : Moon;
  return (
    <Select
      value={theme}
      onValueChange={(value) => setThemePreference(value as ThemePreference)}
    >
      <SelectTrigger
        className="theme-trigger size-9 max-[720px]:w-11 max-[720px]:data-[size=default]:h-11 shrink-0 justify-center p-0 [&>svg:last-child]:hidden"
        aria-label="主题设置"
        title="主题设置"
      >
        <Icon aria-hidden="true" />
        <span className="sr-only">
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent position="popper" align="end">
        <SelectItem value="light">
          <Sun aria-hidden="true" />
          浅色
        </SelectItem>
        <SelectItem value="dark">
          <Moon aria-hidden="true" />
          深色
        </SelectItem>
        <SelectItem value="system">
          <Monitor aria-hidden="true" />
          跟随系统
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
