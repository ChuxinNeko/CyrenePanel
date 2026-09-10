"use client";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

/**
 * 环形计量条。
 *
 * 单个比值对上限，按可视化规范属于 Meter：填充色承载严重度
 * （accent → warning → danger），未填充轨道用同色相浅一档，
 * 这样状态在整圈上都读得出来，而不是只看填充长度。
 *
 * 中心数值用文字色而非序列色 —— 颜色是辅助通道，数值本身已经把信息说全了。
 */

export interface GaugeTone {
  /** 填充色的 CSS 变量 */
  stroke: string;
  /** 轨道色，同色相低透明度 */
  track: string;
}

export function gaugeTone(percentage: number): GaugeTone {
  if (percentage >= 90) {
    return { stroke: "var(--destructive)", track: "color-mix(in oklab, var(--destructive) 15%, transparent)" };
  }
  if (percentage >= 70) {
    return { stroke: "var(--warning)", track: "color-mix(in oklab, var(--warning) 18%, transparent)" };
  }
  return { stroke: "var(--chart-1)", track: "color-mix(in oklab, var(--chart-1) 15%, transparent)" };
}

export function RingGauge({
  value,
  label,
  caption,
  size = 104,
  stroke = 8,
  details,
}: {
  /** 0–100 */
  value: number;
  label: string;
  /** 环下方的补充说明，例如 12.9 GB / 15.7 GB */
  caption?: string;
  size?: number;
  stroke?: number;
  /** 传入则悬停展示详情气泡 */
  details?: React.ReactNode;
}) {
  const clamped = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
  const tone = gaugeTone(clamped);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clamped / 100);

  const body = (
    <div className="flex min-w-0 flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        {/* -90° 让进度从正上方起笔 */}
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="-rotate-90"
          role="img"
          aria-label={`${label} ${clamped}%`}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={tone.track}
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={tone.stroke}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            className="transition-[stroke-dashoffset] duration-500 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl leading-6 font-semibold tracking-display tabular-nums">
            {clamped}
            <span className="text-sm font-normal text-mute">%</span>
          </span>
        </div>
      </div>
      <div className="flex min-w-0 flex-col items-center gap-0.5 text-center">
        <span className="eyebrow">{label}</span>
        {caption && (
          <span className="max-w-full truncate font-mono text-[11px] text-mute" title={caption}>
            {caption}
          </span>
        )}
      </div>
    </div>
  );

  if (!details) return body;

  return (
    <HoverCard>
      {/* 用 button 而不是 div：键盘 Tab 也能聚焦触发，不是纯鼠标可达 */}
      <HoverCardTrigger asChild>
        <button
          type="button"
          className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          aria-label={`${label} ${clamped}%，查看详情`}
        >
          {body}
        </button>
      </HoverCardTrigger>
      <HoverCardContent className="w-72">{details}</HoverCardContent>
    </HoverCard>
  );
}
