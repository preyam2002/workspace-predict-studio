export interface PoolReserves {
  reserveIn: number;
  reserveOut: number;
  feeBps?: number;
}

export interface SecondaryQuote {
  amountIn: number;
  amountOut: number;
  price: number;
  priceImpactPct: number;
}

export function quoteConstantProductExit(amountIn: number, pool: PoolReserves): SecondaryQuote {
  const feeBps = pool.feeBps ?? 30;
  const amountAfterFee = amountIn * (1 - feeBps / 10_000);
  const amountOut = (pool.reserveOut * amountAfterFee) / (pool.reserveIn + amountAfterFee);
  const mid = pool.reserveOut / pool.reserveIn;
  const price = amountOut / amountIn;
  return {
    amountIn,
    amountOut,
    price,
    priceImpactPct: mid === 0 ? 0 : Math.max(0, (1 - price / mid) * 100),
  };
}

export function navDiscountPct(navPrice: number, secondaryPrice: number): number {
  if (navPrice <= 0) return 0;
  return ((secondaryPrice - navPrice) / navPrice) * 100;
}
