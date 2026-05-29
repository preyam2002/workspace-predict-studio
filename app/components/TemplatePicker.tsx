'use client';

import { ArrowDown, ArrowUp, ChartNoAxesCombined, GitBranch, MoveHorizontal, Waves } from 'lucide-react';
import { USDC, type OracleState, type Template, type TemplateKind } from '@/lib/types';

const options: { kind: TemplateKind; label: string; icon: React.ReactNode }[] = [
  { kind: 'capped_bull', label: 'Capped Bull', icon: <ArrowUp size={16} /> },
  { kind: 'capped_bear', label: 'Capped Bear', icon: <ArrowDown size={16} /> },
  { kind: 'strangle', label: 'Strangle', icon: <MoveHorizontal size={16} /> },
  { kind: 'range', label: 'Range', icon: <GitBranch size={16} /> },
  { kind: 'peak', label: 'Peak', icon: <ChartNoAxesCombined size={16} /> },
  { kind: 'ramp', label: 'Ramp', icon: <Waves size={16} /> },
];

function usdScale(value: number) {
  return Math.round(value / 1_000_000_000);
}

export function defaultTemplate(oracle: OracleState): Template {
  const spot = oracle.spot;
  return {
    kind: 'capped_bull',
    K: spot,
    maxLossUsd: 50,
    payoffUsd: 200,
  };
}

export function TemplatePicker({
  oracle,
  template,
  onChange,
}: {
  oracle: OracleState;
  template: Template;
  onChange: (template: Template) => void;
}) {
  const setKind = (kind: TemplateKind) => {
    const spot = oracle.spot;
    const width = oracle.tickSize * 8;
    const qty = USDC;
    const next: Record<TemplateKind, Template> = {
      digital_call: { kind: 'digital_call', K: spot, qty },
      digital_put: { kind: 'digital_put', K: spot, qty },
      capped_bull: { kind: 'capped_bull', K: spot, maxLossUsd: 50, payoffUsd: 200 },
      capped_bear: { kind: 'capped_bear', K: spot, maxLossUsd: 50, payoffUsd: 200 },
      strangle: { kind: 'strangle', kLo: spot - width, kHi: spot + width, qty },
      range: { kind: 'range', K1: spot - width, K2: spot + width, qty },
      peak: { kind: 'peak', center: spot, width, qty },
      ramp: { kind: 'ramp', from: spot - width, to: spot + width, steps: 4, qty: 4 * USDC, bullish: true },
    };
    onChange(next[kind]);
  };

  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="metric-label">Template</div>
          <h2 className="text-base font-semibold">Strategy Shape</h2>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {options.map((item) => (
          <button
            key={item.kind}
            className={`icon-button justify-start ${template.kind === item.kind ? 'primary-button' : ''}`}
            type="button"
            onClick={() => setKind(item.kind)}
            title={item.label}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <TemplateFields oracle={oracle} template={template} onChange={onChange} />
      </div>
    </section>
  );
}

function NumericField({
  label,
  value,
  onChange,
  moneyScale = true,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  moneyScale?: boolean;
}) {
  return (
    <label className="block">
      <span className="metric-label">{label}</span>
      <input
        className="control mt-1"
        type="number"
        value={moneyScale ? usdScale(value) : value}
        onChange={(event) => onChange(Number(event.target.value) * (moneyScale ? 1_000_000_000 : 1))}
      />
    </label>
  );
}

function TemplateFields({
  oracle,
  template,
  onChange,
}: {
  oracle: OracleState;
  template: Template;
  onChange: (template: Template) => void;
}) {
  switch (template.kind) {
    case 'capped_bull':
    case 'capped_bear':
      return (
        <>
          <NumericField label="Strike" value={template.K} onChange={(K) => onChange({ ...template, K })} />
          <NumericField
            label="Payoff $"
            value={template.payoffUsd}
            moneyScale={false}
            onChange={(payoffUsd) => onChange({ ...template, payoffUsd })}
          />
          <NumericField
            label="Max Loss $"
            value={template.maxLossUsd}
            moneyScale={false}
            onChange={(maxLossUsd) => onChange({ ...template, maxLossUsd })}
          />
        </>
      );
    case 'strangle':
      return (
        <>
          <NumericField label="Put Strike" value={template.kLo} onChange={(kLo) => onChange({ ...template, kLo })} />
          <NumericField label="Call Strike" value={template.kHi} onChange={(kHi) => onChange({ ...template, kHi })} />
          <NumericField label="Contracts" value={template.qty / USDC} moneyScale={false} onChange={(qty) => onChange({ ...template, qty: qty * USDC })} />
        </>
      );
    case 'range':
      return (
        <>
          <NumericField label="Lower" value={template.K1} onChange={(K1) => onChange({ ...template, K1 })} />
          <NumericField label="Upper" value={template.K2} onChange={(K2) => onChange({ ...template, K2 })} />
          <NumericField label="Contracts" value={template.qty / USDC} moneyScale={false} onChange={(qty) => onChange({ ...template, qty: qty * USDC })} />
        </>
      );
    case 'peak':
      return (
        <>
          <NumericField label="Center" value={template.center} onChange={(center) => onChange({ ...template, center })} />
          <NumericField label="Width" value={template.width} onChange={(width) => onChange({ ...template, width })} />
          <NumericField label="Contracts" value={template.qty / USDC} moneyScale={false} onChange={(qty) => onChange({ ...template, qty: qty * USDC })} />
        </>
      );
    case 'ramp':
      return (
        <>
          <NumericField label="From" value={template.from} onChange={(from) => onChange({ ...template, from })} />
          <NumericField label="To" value={template.to} onChange={(to) => onChange({ ...template, to })} />
          <NumericField label="Steps" value={template.steps} moneyScale={false} onChange={(steps) => onChange({ ...template, steps })} />
          <label className="block">
            <span className="metric-label">Direction</span>
            <select
              className="control mt-1"
              value={template.bullish ? 'bullish' : 'bearish'}
              onChange={(event) => onChange({ ...template, bullish: event.target.value === 'bullish' })}
            >
              <option value="bullish">Bullish</option>
              <option value="bearish">Bearish</option>
            </select>
          </label>
        </>
      );
    case 'digital_call':
    case 'digital_put':
      return (
        <>
          <NumericField label="Strike" value={template.K} onChange={(K) => onChange({ ...template, K })} />
          <NumericField label="Contracts" value={template.qty / USDC} moneyScale={false} onChange={(qty) => onChange({ ...template, qty: qty * USDC })} />
        </>
      );
    default:
      return <MetricFallback spot={oracle.spot} />;
  }
}

function MetricFallback({ spot }: { spot: number }) {
  return <div className="metric-label col-span-2">Spot {usdScale(spot)}</div>;
}
