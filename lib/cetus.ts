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

export type CetusEnv = 'mainnet' | 'testnet';
export const CETUS_DEFAULT_RPC: Record<CetusEnv, string> = {
  mainnet: 'https://fullnode.mainnet.sui.io:443',
  testnet: 'https://fullnode.testnet.sui.io:443',
};

export interface CetusPoolLike {
  id?: string;
  coin_type_a?: string;
  coin_type_b?: string;
  current_sqrt_price: string | number | bigint;
  fee_rate?: string | number;
}

export interface CetusSdkLike {
  sdkOptions?: {
    env?: CetusEnv;
    clmm_pool?: {
      package_id?: string;
      published_at?: string;
    };
  };
  Pool: {
    getPoolsWithPage?: (args?: { limit?: number }) => Promise<{ data?: Array<{ id?: string }>; hasNextPage?: boolean }>;
    getPool?: (poolId: string) => Promise<CetusPoolLike>;
    calculateCreatePoolWithPrice?: (params: any) => Promise<unknown>;
    createPoolWithPricePayload?: (params: any) => Promise<unknown>;
  };
}

export interface CetusDeploymentStatus {
  deployed: boolean;
  env?: CetusEnv;
  packageId?: string;
  publishedAt?: string;
  samplePoolId?: string;
}

export interface CetusSecondaryPrice {
  source: 'cetus' | 'mock';
  poolId: string;
  price: number;
  rawPrice: number;
  inverted: boolean;
  coinTypeA?: string;
  coinTypeB?: string;
  feeRate?: number;
  reason?: string;
}

export interface ReadCetusSecondaryPriceParams {
  poolId: string;
  baseCoinType: string;
  quoteCoinType: string;
  baseDecimals?: number;
  quoteDecimals?: number;
}

export interface CreateCetusPoolWithPriceParams {
  coinTypeA: string;
  coinTypeB: string;
  tickSpacing: number;
  currentPrice: string;
  coinAmount: string;
  fixAmountA: boolean;
  coinDecimalsA: number;
  coinDecimalsB: number;
  priceBaseCoin: 'coin_a' | 'coin_b';
  slippage: number;
  fullRange?: boolean;
  minPrice?: string;
  maxPrice?: string;
}

export interface CetusMarketEnv {
  [key: string]: string | undefined;
  NEXT_PUBLIC_CETUS_STUDIO_POOL_ID?: string;
  NEXT_PUBLIC_CETUS_BASE_COIN_TYPE?: string;
  NEXT_PUBLIC_CETUS_QUOTE_COIN_TYPE?: string;
  NEXT_PUBLIC_CETUS_BASE_DECIMALS?: string;
  NEXT_PUBLIC_CETUS_QUOTE_DECIMALS?: string;
  NEXT_PUBLIC_PREDICT_STUDIO_PACKAGE?: string;
  NEXT_PUBLIC_DUSDC_TYPE?: string;
  NEXT_PUBLIC_SUI_NETWORK?: string;
}

export interface CetusMarketConfig extends ReadCetusSecondaryPriceParams {
  env: CetusEnv;
}

export function studioLpCoinType(packageId: string): string {
  return `${packageId}::studio_lp::STUDIO_LP`;
}

export function cetusMarketConfigFromEnv(env: CetusMarketEnv): CetusMarketConfig | undefined {
  const poolId = env.NEXT_PUBLIC_CETUS_STUDIO_POOL_ID;
  const baseCoinType =
    env.NEXT_PUBLIC_CETUS_BASE_COIN_TYPE ??
    (env.NEXT_PUBLIC_PREDICT_STUDIO_PACKAGE ? studioLpCoinType(env.NEXT_PUBLIC_PREDICT_STUDIO_PACKAGE) : undefined);
  const quoteCoinType = env.NEXT_PUBLIC_CETUS_QUOTE_COIN_TYPE ?? env.NEXT_PUBLIC_DUSDC_TYPE;
  if (!poolId || !baseCoinType || !quoteCoinType) return undefined;
  return {
    poolId,
    baseCoinType,
    quoteCoinType,
    baseDecimals: Number(env.NEXT_PUBLIC_CETUS_BASE_DECIMALS ?? 6),
    quoteDecimals: Number(env.NEXT_PUBLIC_CETUS_QUOTE_DECIMALS ?? 6),
    env: env.NEXT_PUBLIC_SUI_NETWORK === 'mainnet' ? 'mainnet' : 'testnet',
  };
}

export function mockCetusSecondaryPrice(reason = 'missing STUDIO_LP/dUSDC Cetus pool config'): CetusSecondaryPrice {
  const quote = quoteConstantProductExit(1_000, { reserveIn: 100_000, reserveOut: 99_000, feeBps: 30 });
  return {
    source: 'mock',
    poolId: 'mock',
    price: quote.price,
    rawPrice: quote.price,
    inverted: false,
    reason,
  };
}

export async function createCetusSdk(env: CetusEnv = 'testnet', fullRpcUrl?: string): Promise<CetusSdkLike> {
  const { CetusClmmSDK } = await import('@cetusprotocol/sui-clmm-sdk');
  return CetusClmmSDK.createSDK({ env, full_rpc_url: fullRpcUrl ?? CETUS_DEFAULT_RPC[env] });
}

export async function verifyCetusDeployment(sdk?: CetusSdkLike): Promise<CetusDeploymentStatus> {
  const source = sdk ?? (await createCetusSdk('testnet'));
  const page = source.Pool.getPoolsWithPage ? await source.Pool.getPoolsWithPage({ limit: 1 }) : undefined;
  const packageId = source.sdkOptions?.clmm_pool?.package_id;
  return {
    deployed: Boolean(packageId),
    env: source.sdkOptions?.env,
    packageId,
    publishedAt: source.sdkOptions?.clmm_pool?.published_at,
    samplePoolId: page?.data?.[0]?.id,
  };
}

export async function cetusSqrtPriceX64ToPrice(sqrtPriceX64: string | number | bigint, decimalsA = 6, decimalsB = 6): Promise<number> {
  const { TickMath } = await import('@cetusprotocol/common-sdk');
  return Number(TickMath.sqrtPriceX64ToPrice(BigInt(String(sqrtPriceX64)) as never, decimalsA, decimalsB).toString());
}

function sameCoinType(a?: string, b?: string) {
  return a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase();
}

export async function readCetusSecondaryPrice(
  params: ReadCetusSecondaryPriceParams,
  sdk?: CetusSdkLike,
): Promise<CetusSecondaryPrice> {
  const source = sdk ?? (await createCetusSdk('testnet'));
  if (!source.Pool.getPool) throw new Error('Cetus SDK does not expose Pool.getPool');
  const pool = await source.Pool.getPool(params.poolId);
  const coinTypeA = pool.coin_type_a;
  const coinTypeB = pool.coin_type_b;
  const rawPrice = await cetusSqrtPriceX64ToPrice(pool.current_sqrt_price, params.baseDecimals ?? 6, params.quoteDecimals ?? 6);
  const inverted = sameCoinType(coinTypeB, params.baseCoinType) && sameCoinType(coinTypeA, params.quoteCoinType);
  const aligned =
    sameCoinType(coinTypeA, params.baseCoinType) && sameCoinType(coinTypeB, params.quoteCoinType);

  if (!aligned && !inverted) {
    throw new Error(`Cetus pool ${params.poolId} does not match requested base/quote coin types`);
  }

  return {
    source: 'cetus',
    poolId: pool.id ?? params.poolId,
    price: inverted ? 1 / rawPrice : rawPrice,
    rawPrice,
    inverted,
    coinTypeA,
    coinTypeB,
    feeRate: pool.fee_rate === undefined ? undefined : Number(pool.fee_rate),
  };
}

export async function buildCreateCetusPoolWithPriceTx(
  params: CreateCetusPoolWithPriceParams,
  sdk?: CetusSdkLike,
): Promise<unknown> {
  const source = sdk ?? (await createCetusSdk('testnet'));
  if (!source.Pool.calculateCreatePoolWithPrice || !source.Pool.createPoolWithPricePayload) {
    throw new Error('Cetus SDK does not expose create-pool-with-price helpers');
  }
  const addModeParams = params.fullRange
    ? { is_full_range: true }
    : {
        is_full_range: false,
        min_price: params.minPrice,
        max_price: params.maxPrice,
      };
  const calculateResult = await source.Pool.calculateCreatePoolWithPrice({
    tick_spacing: params.tickSpacing,
    current_price: params.currentPrice,
    coin_amount: params.coinAmount,
    fix_amount_a: params.fixAmountA,
    add_mode_params: addModeParams,
    coin_decimals_a: params.coinDecimalsA,
    coin_decimals_b: params.coinDecimalsB,
    price_base_coin: params.priceBaseCoin,
    slippage: params.slippage,
  });

  return source.Pool.createPoolWithPricePayload({
    tick_spacing: params.tickSpacing,
    calculate_result: calculateResult,
    add_mode_params: addModeParams,
    coin_type_a: params.coinTypeA,
    coin_type_b: params.coinTypeB,
  });
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
