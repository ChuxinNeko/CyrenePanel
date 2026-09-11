/**
 * 生成 lib/world-map-data.json：请求地图的世界轮廓。
 *
 *   bun run build:world-map
 *
 * 数据源是 world-atlas 的 countries-110m（Natural Earth 110m，公有领域）。
 * 产物已提交进仓库，运行时不联网——面板不该为了画张图就把用户浏览器
 * 甩给第三方 CDN，离线部署的机器也得能用。
 *
 * 轮廓按等距圆柱（plate carrée）直接用经纬度画，所以前端定位一个坐标点
 * 只要做一次线性映射，不需要投影库。
 */

import { writeFileSync } from "node:fs";

const SOURCE = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";
const TARGET = "lib/world-map-data.json";

/** 经纬度保留一位小数≈11km。地图宽 900px 时不到 0.3px，肉眼无差别 */
const PRECISION = 1;
/** 比这个还小的岛屿画出来只有一两像素，纯属噪点 */
const MIN_SPAN_DEGREES = 1.5;
/** 道格拉斯-普克容差。900px 宽时 1° ≈ 2.5px，0.4° 的偏差看不出来，点数却能砍掉大半 */
const TOLERANCE_DEGREES = 0.4;

interface Topology {
  transform?: { scale: [number, number]; translate: [number, number] };
  arcs: number[][][];
  objects: Record<string, { type: string; geometries: Geometry[] }>;
}

interface Geometry {
  type: string;
  arcs?: number[][] | number[][][];
}

type Point = [number, number];

function decodeArcs(topology: Topology): Point[][] {
  const { scale, translate } = topology.transform ?? {
    scale: [1, 1] as [number, number],
    translate: [0, 0] as [number, number],
  };
  return topology.arcs.map((arc) => {
    // 量化后的点是增量编码的，累加才是真实坐标
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]] as Point;
    });
  });
}

/** 负索引表示反向复用同一条弧；接续时要去掉重复的首点 */
function ringFromArcs(indexes: number[], arcs: Point[][]): Point[] {
  const ring: Point[] = [];
  for (const index of indexes) {
    const arc = index < 0 ? [...arcs[~index]].reverse() : arcs[index];
    ring.push(...(ring.length ? arc.slice(1) : arc));
  }
  return ring;
}

/** 点到线段的垂距，道格拉斯-普克的取舍依据 */
function perpendicularDistance(point: Point, start: Point, end: Point): number {
  const [px, py] = point;
  const [sx, sy] = start;
  const [ex, ey] = end;
  const dx = ex - sx;
  const dy = ey - sy;
  if (dx === 0 && dy === 0) return Math.hypot(px - sx, py - sy);
  const t = Math.max(0, Math.min(1, ((px - sx) * dx + (py - sy) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (sx + t * dx), py - (sy + t * dy));
}

function douglasPeucker(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points;
  let maxDistance = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const distance = perpendicularDistance(points[i], points[0], points[points.length - 1]);
    if (distance > maxDistance) {
      maxDistance = distance;
      index = i;
    }
  }
  if (maxDistance <= tolerance) return [points[0], points[points.length - 1]];
  return [
    ...douglasPeucker(points.slice(0, index + 1), tolerance).slice(0, -1),
    ...douglasPeucker(points.slice(index), tolerance),
  ];
}

function simplify(input: Point[]): number[] | null {
  const ring = douglasPeucker(input, TOLERANCE_DEGREES);
  const flat: number[] = [];
  let lastX: number | null = null;
  let lastY: number | null = null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const [lon, lat] of ring) {
    const x = Number(lon.toFixed(PRECISION));
    const y = Number(lat.toFixed(PRECISION));
    if (x === lastX && y === lastY) continue;
    flat.push(x, y);
    lastX = x;
    lastY = y;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  if (flat.length < 8) return null;
  if (maxX - minX < MIN_SPAN_DEGREES && maxY - minY < MIN_SPAN_DEGREES) return null;
  return flat;
}

async function main(): Promise<void> {
  console.log(`下载 ${SOURCE}`);
  const response = await fetch(SOURCE);
  if (!response.ok) throw new Error(`下载失败: HTTP ${response.status}`);
  const topology = (await response.json()) as Topology;

  const arcs = decodeArcs(topology);
  const countries = topology.objects.countries;
  if (!countries) throw new Error("拓扑里没有 countries 对象");

  const rings: number[][] = [];
  for (const geometry of countries.geometries) {
    if (!geometry.arcs) continue;
    const polygons =
      geometry.type === "Polygon"
        ? [geometry.arcs as number[][]]
        : (geometry.arcs as number[][][]);
    for (const polygon of polygons) {
      for (const ringIndexes of polygon) {
        const simplified = simplify(ringFromArcs(ringIndexes, arcs));
        if (simplified) rings.push(simplified);
      }
    }
  }

  const output = JSON.stringify({ rings });
  writeFileSync(TARGET, output);
  const points = rings.reduce((sum, ring) => sum + ring.length / 2, 0);
  console.log(
    `已写入 ${TARGET}：${rings.length} 个轮廓 / ${points} 个点 / ${(output.length / 1024).toFixed(1)} KB`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
