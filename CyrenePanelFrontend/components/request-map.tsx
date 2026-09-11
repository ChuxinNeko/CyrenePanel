"use client";

import { useMemo, useState } from "react";
import worldMap from "@/lib/world-map-data.json";
import { formatCount, type GeoPoint } from "@/lib/site-stats";

/**
 * 请求来源地图。
 *
 * 轮廓用等距圆柱（plate carrée）画，所以经纬度到画布坐标就是一次线性映射，
 * 不需要投影库：x = 经度 + 180，y = 90 - 纬度，viewBox 直接就是经纬度网格。
 *
 * 南极一圈基本不会有访问，纬度裁到 [-58, 84]，省下来的高度给有人住的地方。
 */

const LAT_TOP = 84;
const LAT_BOTTOM = -58;
const VIEW_X = 0;
const VIEW_Y = 90 - LAT_TOP;
const VIEW_W = 360;
const VIEW_H = LAT_TOP - LAT_BOTTOM;

const rings = (worldMap as { rings: number[][] }).rings;

const LAND_PATH = rings
  .map((ring) => {
    let d = "";
    for (let i = 0; i < ring.length; i += 2) {
      d += `${i === 0 ? "M" : "L"}${(ring[i] + 180).toFixed(1)} ${(90 - ring[i + 1]).toFixed(1)}`;
    }
    return `${d}Z`;
  })
  .join("");

interface Hovered {
  point: GeoPoint;
  leftPercent: number;
  topPercent: number;
}

export function RequestMap({
  points,
  coverage,
}: {
  points: GeoPoint[];
  coverage?: { lookedUp: number; totalIps: number };
}) {
  const [hovered, setHovered] = useState<Hovered | null>(null);

  const maxRequests = useMemo(
    () => points.reduce((max, point) => Math.max(max, point.requests), 0),
    [points],
  );

  // 半径按请求数开平方：按面积表达数量，线性半径会让大点大得离谱
  const radiusOf = (requests: number) => {
    if (maxRequests <= 0) return 1.2;
    return 1.1 + 2.9 * Math.sqrt(requests / maxRequests);
  };

  const project = (point: GeoPoint) => ({
    x: point.longitude + 180,
    y: 90 - point.latitude,
  });

  return (
    <div className="relative">
      <svg
        viewBox={`${VIEW_X} ${VIEW_Y} ${VIEW_W} ${VIEW_H}`}
        className="w-full rounded-lg bg-surface-inset"
        role="img"
        aria-label="请求来源分布地图"
      >
        {/*
          陆地不能用 muted/border：它俩和 surface-inset 在两套主题下都是同一个色值
          （亮 #f5f5f5、暗 #1f1f1f），画出来等于没画。改用 muted-foreground 压低透明度，
          亮暗两边都能和海面拉开。
          描边加 non-scaling-stroke：线宽按屏幕像素算，不随 viewBox 缩放被稀释成半像素。
        */}
        <path
          d={LAND_PATH}
          className="fill-muted-foreground/25 stroke-muted-foreground/55"
          strokeWidth={0.8}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {points.map((point) => {
          const { x, y } = project(point);
          // 裁掉的纬度带里若真有点，贴边画出来，总比凭空消失强
          const cy = Math.min(Math.max(y, VIEW_Y + 1), VIEW_Y + VIEW_H - 1);
          return (
            <circle
              key={`${point.latitude},${point.longitude}`}
              cx={x}
              cy={cy}
              r={radiusOf(point.requests)}
              // 底图压深之后，近黑/近白的 primary 点会糊进陆地，数据标记换成 chart-1
              className="cursor-pointer fill-chart-1/70 stroke-chart-1 transition-opacity hover:fill-chart-1"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              onMouseEnter={() =>
                setHovered({
                  point,
                  leftPercent: ((x - VIEW_X) / VIEW_W) * 100,
                  topPercent: ((cy - VIEW_Y) / VIEW_H) * 100,
                })
              }
              onMouseLeave={() => setHovered(null)}
            />
          );
        })}
      </svg>

      {hovered && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-elev-2"
          style={{ left: `${hovered.leftPercent}%`, top: `${hovered.topPercent}%` }}
        >
          <div className="font-medium whitespace-nowrap">{hovered.point.label || "未知位置"}</div>
          <div className="mt-0.5 font-mono text-[11px] whitespace-nowrap text-mute">
            {formatCount(hovered.point.requests)} 次请求 · {hovered.point.ips} 个 IP
          </div>
        </div>
      )}

      {points.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="rounded-md bg-card/80 px-3 py-1.5 text-xs text-mute">
            没有可定位的来源
          </p>
        </div>
      )}

      {coverage && coverage.totalIps > coverage.lookedUp && (
        <p className="mt-2 text-[11px] text-mute">
          来源 IP 共 {formatCount(coverage.totalIps)} 个，地图只解析了请求最多的{" "}
          {formatCount(coverage.lookedUp)} 个
        </p>
      )}
    </div>
  );
}
