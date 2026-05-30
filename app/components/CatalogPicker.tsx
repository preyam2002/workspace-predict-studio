'use client';

import { Boxes, ChartNoAxesCombined, Gauge, Goal, Layers, MoveHorizontal, Shield, Split, TrendingDown, TrendingUp, Waves, Waypoints } from 'lucide-react';
import { catalogProducts, type CatalogProductId } from '@/lib/catalog';

const icons: Record<CatalogProductId, React.ReactNode> = {
  capped_bull_note: <TrendingUp size={16} />,
  capped_bear_note: <TrendingDown size={16} />,
  digital_call_note: <Goal size={16} />,
  digital_put_note: <Shield size={16} />,
  iron_condor_income: <MoveHorizontal size={16} />,
  twin_win: <Split size={16} />,
  shark_fin: <Waves size={16} />,
  fixed_coupon_range: <Gauge size={16} />,
  digital_ladder: <Waypoints size={16} />,
  barrier_box: <Boxes size={16} />,
  butterfly_pin: <ChartNoAxesCombined size={16} />,
  dual_range_barbell: <Layers size={16} />,
};

export function CatalogPicker({
  selected,
  onChange,
}: {
  selected: CatalogProductId;
  onChange: (id: CatalogProductId) => void;
}) {
  return (
    <section className="panel p-4">
      <div className="mb-3">
        <div className="metric-label">Catalog</div>
        <h2 className="text-base font-semibold">Retail Notes</h2>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {catalogProducts.map((product) => (
          <button
            key={product.id}
            className={`icon-button justify-start ${selected === product.id ? 'primary-button' : ''}`}
            type="button"
            onClick={() => onChange(product.id)}
            title={product.label}
          >
            {icons[product.id]}
            <span className="truncate">{product.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
