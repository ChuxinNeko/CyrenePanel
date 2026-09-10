"use client";

import { useRef, useState } from "react";

/**
 * 监控折线图。
 *
 * 按可视化规范：2px 线、10% 同色相面积、≥8px 端点带 2px 表面色描环、
 * 发丝级实线网格。两条及以上序列必须有图例，且当前值直接标注，
 * 数值不只挂在悬停上。悬停给十字准星，键盘可用方向键逐点读数。
 */

export interface ChartSeries {
  name: string;
  /** CSS 变量，例如 var(--chart-1) */
  color: string;
  data: number[];
  /** 把原始值渲染成可读文本，例如 19.0 KB/s */
  format: (value: number) => string;
}

export function MetricChart({
  series,
  height = 220,
}: {
  series: ChartSeries[];
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const length = Math.max(...series.map((s) => s.data.length), 0);

  if (length < 2) {
    return (
      <div
        className="flex items-center justify-center rounded-md bg-surface-inset text-xs text-mute"
        style={{ height }}
      >
        暂无趋势数据
      </div>
    );
  }

  // 所有序列共用一根 Y 轴 —— 双轴会凭空造出并不存在的相关性
  const max = Math.max(
    ...series.flatMap((s) => s.data),
    1,
  ) * 1.15;

  const xAt = (index: number) => (index / (length - 1)) * 100;
  const yAt = (value: number) => 100 - (value / max) * 100;
  const activeIndex = hover ?? length - 1;

  const clampIndex = (index: number) => Math.min(Math.max(index, 0), length - 1);

  const handleMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const box = boxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    setHover(clampIndex(Math.round(ratio * (length - 1))));
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const step = event.key === "ArrowLeft" ? -1 : 1;
      setHover((prev) => clampIndex((prev ?? length - 1) + step));
    } else if (event.key === "Home") {
      event.preventDefault();
      setHover(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setHover(length - 1);
    } else if (event.key === "Escape") {
      setHover(null);
    }
  };

  return (
    <div className="space-y-3">
      {/* 图例兼当前值读数：颜色之外始终有文字承载身份与数值 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {series.map((s) => {
          const value = s.data[activeIndex] ?? s.data[s.data.length - 1] ?? 0;
          return (
            <span key={s.name} className="inline-flex items-center gap-1.5 text-xs">
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              <span className="text-muted-foreground">{s.name}</span>
              <span className="font-mono font-medium tabular-nums" aria-live="polite">
                {s.format(value)}
              </span>
            </span>
          );
        })}
      </div>

      <div
        ref={boxRef}
        tabIndex={0}
        role="group"
        aria-label="监控趋势图，方向键逐点读数"
        className="relative w-full cursor-crosshair rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        style={{ height }}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
        onKeyDown={handleKeyDown}
        onBlur={() => setHover(null)}
      >
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
        >
          {[20, 40, 60, 80].map((y) => (
            <line
              key={y}
              x1="0"
              x2="100"
              y1={y}
              y2={y}
              stroke="var(--border)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {series.map((s) => {
            const points = s.data.map((v, i) => `${xAt(i)},${yAt(v)}`).join(" ");
            return (
              <g key={s.name}>
                <polygon
                  points={`0,100 ${points} 100,100`}
                  fill={s.color}
                  fillOpacity="0.1"
                />
                <polyline
                  points={points}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}

          {hover !== null && (
            <line
              x1={xAt(activeIndex)}
              x2={xAt(activeIndex)}
              y1="0"
              y2="100"
              stroke="var(--border)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {/* 端点用 DOM 画：preserveAspectRatio=none 会把 SVG 圆压成椭圆 */}
        {series.map((s) => {
          const value = s.data[activeIndex];
          if (value === undefined) return null;
          return (
            <span
              key={s.name}
              className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                left: `${xAt(activeIndex)}%`,
                top: `${yAt(value)}%`,
                backgroundColor: s.color,
                boxShadow: "0 0 0 2px var(--card)",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
