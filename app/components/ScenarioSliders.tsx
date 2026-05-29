'use client';

export interface Scenario {
  spotShiftPct: number;
  volShiftPct: number;
}

export function ScenarioSliders({
  scenario,
  onChange,
}: {
  scenario: Scenario;
  onChange: (scenario: Scenario) => void;
}) {
  return (
    <section className="panel p-4">
      <div className="metric-label">Scenario</div>
      <h2 className="text-base font-semibold">Surface Shifts</h2>
      <Slider
        label="Spot"
        value={scenario.spotShiftPct}
        min={-10}
        max={10}
        suffix="%"
        onChange={(spotShiftPct) => onChange({ ...scenario, spotShiftPct })}
      />
      <Slider
        label="SVI sigma"
        value={scenario.volShiftPct}
        min={-50}
        max={50}
        suffix="%"
        onChange={(volShiftPct) => onChange({ ...scenario, volShiftPct })}
      />
    </section>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="mt-4 block">
      <span className="flex items-center justify-between text-sm">
        <span className="metric-label">{label}</span>
        <span className="metric-value">
          {value}
          {suffix}
        </span>
      </span>
      <input
        className="mt-2 w-full accent-[#58a6ff]"
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
