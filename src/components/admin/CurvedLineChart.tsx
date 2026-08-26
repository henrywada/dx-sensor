"use client";

import { useMemo, useState } from "react";
import type { DailyCountPoint } from "@/lib/admin/getDashboardStats";

type CurvedLineChartProps = {
  data: DailyCountPoint[];
  stroke?: string;
  height?: number;
};

function buildSmoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    const p = points[0];
    return `M ${p.x} ${p.y}`;
  }

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? i : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

function formatAxisDate(isoDate: string): string {
  const [, m, d] = isoDate.split("-");
  return `${Number(m)}/${Number(d)}`;
}

export function CurvedLineChart({
  data,
  stroke = "#0e7c86",
  height = 180,
}: CurvedLineChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const padding = { top: 16, right: 12, bottom: 28, left: 36 };
  const width = 640;
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const { points, maxY, yTicks, xLabelIndexes } = useMemo(() => {
    const maxVal = Math.max(1, ...data.map((p) => p.count));
    const niceMax = Math.ceil(maxVal);
    const pts = data.map((p, i) => {
      const x =
        padding.left +
        (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
      const y = padding.top + innerH - (p.count / niceMax) * innerH;
      return { x, y, ...p };
    });

    const tickCount = Math.min(4, niceMax);
    const ticks: number[] = [];
    for (let i = 0; i <= tickCount; i++) {
      ticks.push(Math.round((niceMax * i) / tickCount));
    }

    const labelIndexes: number[] = [];
    if (data.length > 0) {
      const step = Math.max(1, Math.floor((data.length - 1) / 5));
      for (let i = 0; i < data.length; i += step) labelIndexes.push(i);
      if (labelIndexes[labelIndexes.length - 1] !== data.length - 1) {
        labelIndexes.push(data.length - 1);
      }
    }

    return {
      points: pts,
      maxY: niceMax,
      yTicks: [...new Set(ticks)],
      xLabelIndexes: labelIndexes,
    };
  }, [data, innerH, innerW, padding.left, padding.top]);

  const path = buildSmoothPath(points);
  const hovered = hoverIndex !== null ? points[hoverIndex] : null;

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label="日別件数の折れ線チャート"
        onMouseLeave={() => setHoverIndex(null)}
      >
        {yTicks.map((tick) => {
          const y = padding.top + innerH - (tick / maxY) * innerH;
          return (
            <g key={tick}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
                stroke="#e5e7eb"
                strokeWidth={1}
              />
              <text
                x={padding.left - 8}
                y={y + 3}
                textAnchor="end"
                className="fill-ink-soft"
                fontSize={10}
              >
                {tick}
              </text>
            </g>
          );
        })}

        {xLabelIndexes.map((i) => {
          const p = points[i];
          if (!p) return null;
          return (
            <text
              key={p.date}
              x={p.x}
              y={height - 8}
              textAnchor="middle"
              className="fill-ink-soft"
              fontSize={10}
            >
              {formatAxisDate(p.date)}
            </text>
          );
        })}

        {path && (
          <path
            d={path}
            fill="none"
            stroke={stroke}
            strokeWidth={2.25}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {points.map((p, i) => (
          <circle
            key={p.date}
            cx={p.x}
            cy={p.y}
            r={hoverIndex === i ? 4.5 : 3}
            fill={stroke}
            opacity={hoverIndex === null || hoverIndex === i ? 1 : 0.35}
            onMouseEnter={() => setHoverIndex(i)}
          />
        ))}

        {points.map((p, i) => (
          <rect
            key={`hit-${p.date}`}
            x={p.x - innerW / Math.max(data.length, 1) / 2}
            y={padding.top}
            width={Math.max(8, innerW / Math.max(data.length, 1))}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHoverIndex(i)}
          />
        ))}
      </svg>

      {hovered && (
        <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-md border border-line bg-white px-2.5 py-1 text-xs text-ink shadow-sm">
          {hovered.date} · {hovered.count} 件
        </div>
      )}
    </div>
  );
}
