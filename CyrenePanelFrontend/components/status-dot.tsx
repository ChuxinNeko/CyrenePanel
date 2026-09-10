import { cn } from "@/lib/utils";

/**
 * 状态点 + 文字标签。
 * 颜色永远只是辅助通道，状态本身由旁边的文字承载——色觉障碍下也读得出。
 */
export function StatusDot({
  dot,
  className,
  children,
}: {
  /** 圆点填充色的工具类，例如 bg-success / bg-destructive */
  dot: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs whitespace-nowrap",
        className
      )}
    >
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", dot)} />
      {children}
    </span>
  );
}
