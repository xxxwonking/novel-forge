export type ThemePreference = "light" | "dark" | "system";
const key = "novel-forge-theme";
const media =
  typeof window === "undefined"
    ? null
    : window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();
const valid = (value: string | null | undefined): ThemePreference =>
  value === "light" || value === "system" ? value : "dark";
let preference =
  typeof document === "undefined"
    ? ("dark" as ThemePreference)
    : valid(document.documentElement.dataset.theme);

function apply(mode: ThemePreference): void {
  preference = mode;
  if (typeof document === "undefined") return;
  const dark =
    mode === "dark" || (mode === "system" && media?.matches === true);
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.dataset.theme = mode;
  root.style.colorScheme = dark ? "dark" : "light";
  for (const listener of listeners) listener();
}

export function setThemePreference(mode: ThemePreference): void {
  try {
    localStorage.setItem(key, mode);
  } catch {
    /* 当前页面仍然生效。 */
  }
  apply(mode);
}
export const getResolvedTheme = (): "light" | "dark" =>
  typeof document === "undefined" ||
  document.documentElement.classList.contains("dark")
    ? "dark"
    : "light";
export const getThemePreference = (): ThemePreference => preference;
export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
media?.addEventListener("change", () => {
  if (preference === "system") apply(preference);
});
if (typeof window !== "undefined")
  window.addEventListener("storage", (event) => {
    // 隔离存储环境可能连读取 localStorage getter 都被禁止。
    let storage: Storage;
    try {
      storage = window.localStorage;
    } catch {
      return;
    }
    if (
      event.storageArea === storage &&
      (event.key === key || event.key === null)
    )
      apply(valid(event.newValue));
  });
apply(preference);
