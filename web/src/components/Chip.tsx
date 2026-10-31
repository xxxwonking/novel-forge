import type { ComponentProps } from "react";
import { Badge } from "./ui/badge.js";
import { cn } from "../lib/utils.js";

/**
 * 状态标签的统一出口。
 *
 * 迁移期间兼容原业务颜色名，统一映射到语义色；底层为 shadcn Badge。
 * 透传 DOM 属性与 ref，让尚未迁移的 Tooltip 仍能绑定事件和无障碍说明。
 */
export function Chip({ color, className, children, ...props }: Omit<ComponentProps<"span">, "color"> & {
  color?: string | undefined;
  className?: string | undefined;
}): React.ReactElement {
  const tone = color === "gold" || color === "orange" || color === "yellow" ? "warning"
    : color === "red" || color === "volcano" || color === "error" ? "danger"
      : color === "cyan" || color === "processing" || color === "blue" || color === "success" || color === "green" ? "info" : "neutral";
  const tones = {
    neutral: "",
    warning: "border-warning/30 bg-warning/10 text-warning",
    danger: "border-danger-foreground/30 bg-destructive/15 text-danger-foreground",
    info: "border-info/30 bg-info/10 text-info",
  };
  return <Badge {...props} variant="outline" data-tone={tone} className={cn("status-chip rounded-md", tones[tone], className ?? "chip")}>{children}</Badge>;
}
