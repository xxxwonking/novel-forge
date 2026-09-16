import { Tag } from "antd";

/**
 * 状态标签的统一出口。
 *
 * antd 的 `Tag` 在 `exactOptionalPropertyTypes` 下不接受 `color={undefined}`，
 * 每到一处都得写一次三元；这里收口成一个组件，顺带统一默认标签的字重与间距。
 */
export function Chip({ color, className, children }: {
  color?: string | undefined;
  className?: string | undefined;
  children: React.ReactNode;
}): React.ReactElement {
  const cls = className ?? "chip";
  return color === undefined
    ? <Tag className={cls}>{children}</Tag>
    : <Tag color={color} className={cls}>{children}</Tag>;
}
