'use client';

import { useEffect, useRef, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';
import { payoffCurve } from '@/lib/payoff';
import { USDC, type Leg } from '@/lib/types';

function strikeDisplayScale(...values: number[]) {
  return Math.max(...values.map((value) => Math.abs(value))) > 1_000_000 ? 1_000_000_000 : 1;
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
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 320 });
  const scale = strikeDisplayScale(lo, hi, spot, ...breakevens);
  const data = payoffCurve(legs, premium, lo, hi).map((point) => ({
    s: point.s,
    pnl: point.pnl / USDC,
  }));
  const maxPnl = data.length > 0 ? Math.max(...data.map((point) => point.pnl)) : 0;
  const minPnl = data.length > 0 ? Math.min(...data.map((point) => point.pnl)) : 0;

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const update = () => {
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setSize({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="h-[320px] w-full">
      {size.width > 0 ? (
        <AreaChart width={size.width} height={size.height} data={data} margin={{ top: 12, right: 18, bottom: 2, left: 0 }}>
          <defs>
            <linearGradient id="pnlFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#3ddc97" stopOpacity={0.38} />
              <stop offset="100%" stopColor="#3ddc97" stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(228,232,240,0.08)" vertical={false} />
          <XAxis
            dataKey="s"
            type="number"
            domain={[lo, hi]}
            tickFormatter={(value) => Math.round(Number(value) / scale).toLocaleString()}
          />
          <YAxis tickFormatter={(value) => `$${value}`} width={58} />
          <Tooltip
            formatter={(value) => [`$${Number(value).toFixed(2)}`, 'P&L']}
            labelFormatter={(value) => `BTC $${Math.round(Number(value) / scale).toLocaleString()}`}
            contentStyle={{ background: '#10151d', border: '1px solid rgba(228,232,240,0.14)', borderRadius: 6 }}
          />
          <ReferenceLine y={0} stroke="rgba(228,232,240,0.55)" />
          {maxPnl > 0 ? <ReferenceLine y={maxPnl} stroke="#3ddc97" strokeDasharray="2 4" /> : null}
          {minPnl < 0 ? <ReferenceLine y={minPnl} stroke="#ff6b6b" strokeDasharray="2 4" /> : null}
          <ReferenceLine x={spot} stroke="#58a6ff" strokeDasharray="4 4" />
          {breakevens.map((point) => (
            <ReferenceLine key={point} x={point} stroke="#f6b44b" strokeDasharray="3 3" />
          ))}
          <Area dataKey="pnl" stroke="#3ddc97" strokeWidth={2} fill="url(#pnlFill)" isAnimationActive={false} />
        </AreaChart>
      ) : null}
    </div>
  );
}
