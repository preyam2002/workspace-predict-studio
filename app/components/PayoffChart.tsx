'use client';

import { useMemo } from 'react';
import { payoffCurve } from '@/lib/payoff';
import { USDC, type Leg } from '@/lib/types';

function strikeDisplayScale(...values: number[]) {
  return Math.max(...values.map((value) => Math.abs(value))) > 1_000_000 ? 1_000_000_000 : 1;
}

const chart = {
  top: 4,
  right: 0,
  bottom: 0,
  left: 0,
};

function linePath(points: { x: number; y: number }[]) {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
}

function formatMoney(value: number) {
  const digits = Math.abs(value) > 0 && Math.abs(value) < 10 ? 2 : 0;
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;
}

export function PayoffChart({
  legs,
  premium,
  lo,
  hi,
  spot,
  breakevens,
}: {
  legs: Leg[];
  premium: number;
  lo: number;
  hi: number;
  spot: number;
  breakevens: number[];
}) {
  const scale = strikeDisplayScale(lo, hi, spot, ...breakevens);
  const data = useMemo(
    () =>
      payoffCurve(legs, premium, lo, hi).map((point) => ({
        s: point.s,
        pnl: point.pnl / USDC,
      })),
    [legs, premium, lo, hi],
  );
  const breakpoints = useMemo(() => [...new Set(breakevens)], [breakevens]);
  const maxPnlRaw = data.length > 0 ? Math.max(...data.map((point) => point.pnl)) : 0;
  const minPnlRaw = data.length > 0 ? Math.min(...data.map((point) => point.pnl)) : 0;
  const pnlRangeRaw = maxPnlRaw - minPnlRaw;
  const pnlScale = Math.max(1, Math.abs(maxPnlRaw), Math.abs(minPnlRaw), pnlRangeRaw);
  const padding = Math.max(pnlRangeRaw * 0.12, pnlScale * 0.05, 0.01);
  const maxPnl = Math.max(0, maxPnlRaw) + padding;
  const minPnl = Math.min(0, minPnlRaw) - padding;
  const yRange = maxPnl - minPnl || 1;
  const xRange = hi - lo || 1;
  const xOf = (value: number) => chart.left + ((value - lo) / xRange) * (100 - chart.left - chart.right);
  const yOf = (value: number) => chart.top + ((maxPnl - value) / yRange) * (100 - chart.top - chart.bottom);
  const curvePoints = data.map((point) => ({ x: xOf(point.s), y: yOf(point.pnl) }));
  const curvePath = linePath(curvePoints);
  const zeroY = yOf(0);
  const areaPath =
    curvePoints.length > 0 ? `${curvePath} L ${curvePoints.at(-1)?.x.toFixed(2)} ${zeroY.toFixed(2)} L ${curvePoints[0].x.toFixed(2)} ${zeroY.toFixed(2)} Z` : '';
  const xTicks = Array.from({ length: 5 }, (_, index) => lo + (xRange * index) / 4);
  const yTicks = Array.from({ length: 5 }, (_, index) => minPnl + (yRange * index) / 4);

  return (
    <div className="payoff-glow relative h-[320px] w-full pb-8 pl-16 pr-8 pt-4">
      <div className="relative h-full w-full">
        <svg className="absolute inset-0 h-full w-full overflow-visible" role="img" viewBox="0 0 100 100" preserveAspectRatio="none">
          <title>Payoff chart</title>
          <defs>
            <linearGradient id="pnlFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--volt)" stopOpacity={0.16} />
              <stop offset="100%" stopColor="var(--volt)" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          {yTicks.map((tick) => (
            <line key={tick} x1={0} x2={100} y1={yOf(tick)} y2={yOf(tick)} stroke="rgba(255,255,255,0.05)" vectorEffect="non-scaling-stroke" />
          ))}
          <line x1={0} x2={100} y1={zeroY} y2={zeroY} stroke="rgba(255,255,255,0.32)" vectorEffect="non-scaling-stroke" />
          <line x1={xOf(spot)} x2={xOf(spot)} y1={chart.top} y2={100} stroke="var(--cyan)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
          {breakpoints.map((point) => (
            <line key={point} x1={xOf(point)} x2={xOf(point)} y1={chart.top} y2={100} stroke="var(--amber)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          ))}
          {areaPath ? <path className="payoff-area" d={areaPath} fill="url(#pnlFill)" /> : null}
          {curvePath ? (
            <path
              className="payoff-curve"
              d={curvePath}
              fill="none"
              stroke="var(--volt)"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.25"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </svg>
        {yTicks.map((tick) => (
          <span
            key={tick}
            className="pointer-events-none absolute right-full -translate-y-1/2 whitespace-nowrap pr-3 font-mono text-[11px] muted-text"
            style={{ top: `${yOf(tick)}%` }}
          >
            {formatMoney(tick)}
          </span>
        ))}
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 translate-y-6">
          {xTicks.map((tick, index) => (
            <span
              key={tick}
              className={`absolute whitespace-nowrap font-mono text-[11px] muted-text ${
                index === 0 ? 'translate-x-0' : index === xTicks.length - 1 ? '-translate-x-full' : '-translate-x-1/2'
              }`}
              style={{ left: `${xOf(tick)}%` }}
            >
              {Math.round(tick / scale).toLocaleString()}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
