'use client';

import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { payoffCurve } from '@/lib/payoff';
import { USDC, type Leg } from '@/lib/types';

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
  const data = payoffCurve(legs, premium, lo, hi).map((point) => ({
    s: Math.round(point.s / 1_000_000_000),
    pnl: point.pnl / USDC,
  }));
  const spotLabel = Math.round(spot / 1_000_000_000);

  return (
    <div className="h-[320px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 12, right: 18, bottom: 2, left: 0 }}>
          <defs>
            <linearGradient id="pnlFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#3ddc97" stopOpacity={0.38} />
              <stop offset="100%" stopColor="#3ddc97" stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(228,232,240,0.08)" vertical={false} />
          <XAxis dataKey="s" type="number" domain={[Math.round(lo / 1_000_000_000), Math.round(hi / 1_000_000_000)]} />
          <YAxis tickFormatter={(value) => `$${value}`} width={58} />
          <Tooltip
            formatter={(value) => [`$${Number(value).toFixed(2)}`, 'P&L']}
            labelFormatter={(value) => `BTC $${Number(value).toLocaleString()}`}
            contentStyle={{ background: '#10151d', border: '1px solid rgba(228,232,240,0.14)', borderRadius: 6 }}
          />
          <ReferenceLine y={0} stroke="rgba(228,232,240,0.55)" />
          <ReferenceLine x={spotLabel} stroke="#58a6ff" strokeDasharray="4 4" />
          {breakevens.map((point) => (
            <ReferenceLine key={point} x={Math.round(point / 1_000_000_000)} stroke="#f6b44b" strokeDasharray="3 3" />
          ))}
          <Area dataKey="pnl" stroke="#3ddc97" strokeWidth={2} fill="url(#pnlFill)" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
