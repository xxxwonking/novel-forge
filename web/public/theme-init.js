// 在样式和 React 加载前恢复主题，避免已保存的浅色偏好闪成深色。
(() => {
  let mode = "dark";
  try {
    const saved = localStorage.getItem("novel-forge-theme");
    if (["light", "dark", "system"].includes(saved)) mode = saved;
  } catch {
    /* 存储不可用时仍可在当前页面切换。 */
  }
  const dark =
    mode === "dark" ||
    (mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.dataset.theme = mode;
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
})();
