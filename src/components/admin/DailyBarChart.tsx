"use client";

import { useMemo, useState } from "react";
import type { DailyYenPoint } from "@/lib/admin/getDashboardStats";
import { formatCostYen } from "@/lib/image-analysis/estimateCostYen";

type DailyBarChartProps = {
  data: DailyYenPoint[];
  fill?: string;
  height?: number;
};

function formatAxisDate(isoDate: string): string {
  const [, m, d] = isoDate.split("-");
  return `${Number(m)}/${Number(d)}`;
}

function niceYenMax(maxVal: number): number {
  if (maxVal <= 0) return 1;
  if (maxVal < 0.1) return Math.ceil(maxVal * 1000) / 1000 || 0.001;
  if (maxVal < 1) return Math.ceil(maxVal * 100) / 100;
  if (maxVal < 10) return Math.ceil(maxVal * 10) / 10;
  return Math.ceil(maxVal);
}

function formatYenTick(v: number): string {
  if (v < 0.01) return v.toFixed(3);
  if (v < 1) return v.toFixed(2);
  if (v < 10) return v.toFixed(1);
  return String(Math.round(v));
}

export function DailyBarChart({
  data,
  fill = "#0055ff",
  height = 180,
}: DailyBarChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const padding = { top: 16, right: 12, bottom: 28, left: 44 };
  const width = 640;
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const { bars, maxY, yTicks, xLabelIndexes } = useMemo(() => {
    const maxVal = Math.max(0, ...data.map((p) => p.yen));
    const niceMax = niceYenMax(maxVal);
    const gap = data.length > 0 ? innerW / data.length : innerW;
    const barW = Math.max(2, gap * 0.65);

    const barPts = data.map((p, i) => {
      const cx = padding.left + gap * i + gap / 2;
      const barH = (p.yen / niceMax) * innerH;
      const y = padding.top + innerH - barH;
      return {
        ...p,
        x: cx - barW / 2,
        cx,
        y,
        width: barW,
        height: Math.max(p.yen > 0 ? 1 : 0, barH),
      };
    });

    const tickCount = 4;
    const ticks: number[] = [];
    for (let i = 0; i <= tickCount; i++) {
      ticks.push(Math.round(((niceMax * i) / tickCount) * 1000) / 1000);
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
      bars: barPts,
      maxY: niceMax,
      yTicks: [...new Set(ticks)],
      xLabelIndexes: labelIndexes,
    };
  }, [data, innerH, innerW, padding.left, padding.top]);

  const hovered = hoverIndex !== null ? bars[hoverIndex] : null;

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label="日別コスト概算のバーチャート"
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
                {formatYenTick(tick)}
              </text>
            </g>
          );
        })}

        {xLabelIndexes.map((i) => {
          const b = bars[i];
          if (!b) return null;
          return (
            <text
              key={b.date}
              x={b.cx}
              y={height - 8}
              textAnchor="middle"
              className="fill-ink-soft"
              fontSize={10}
            >
              {formatAxisDate(b.date)}
            </text>
          );
        })}

        {bars.map((b, i) => (
          <g key={b.date}>
            <rect
              x={b.x}
              y={b.y}
              width={b.width}
              height={b.height}
              fill={fill}
              opacity={hoverIndex === null || hoverIndex === i ? 0.9 : 0.35}
              rx={1.5}
            />
            <rect
              x={b.x}
              y={padding.top}
              width={Math.max(b.width, 8)}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHoverIndex(i)}
            />
          </g>
        ))}
      </svg>

      {hovered && (
        <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-md border border-line bg-white px-2.5 py-1 text-xs text-ink shadow-sm">
          {hovered.date} · {formatCostYen(hovered.yen)}
        </div>
      )}
    </div>
  );
}
