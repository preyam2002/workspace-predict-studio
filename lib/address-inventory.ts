export const PREDICT_STUDIO_PACKAGE_ID = '0xad53c91cb1181690ddd3c0785d64615c425075eb8c555f812181f59541e7758f';
export const PREDICT_DUSDC_TYPE = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';
export const STUDIO_LP_TYPE = `${PREDICT_STUDIO_PACKAGE_ID}::studio_lp::STUDIO_LP`;
export const DEEP_TYPE = '0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8::deep::DEEP';
export const DBUSDC_TYPE = '0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7::DBUSDC::DBUSDC';
export const SUI_TYPE = '0x2::sui::SUI';
export const DEEPBOOK_POOL_CREATION_FEE = 500n * 1_000_000n;

export const IMPORTANT_ASSETS = {
  SUI: { coinType: SUI_TYPE, decimals: 9 },
  PREDICT_DUSDC: { coinType: PREDICT_DUSDC_TYPE, decimals: 6 },
  STUDIO_LP: { coinType: STUDIO_LP_TYPE, decimals: 9 },
  DEEP: { coinType: DEEP_TYPE, decimals: 6 },
  DBUSDC: { coinType: DBUSDC_TYPE, decimals: 6 },
} as const;

export type ImportantAsset = keyof typeof IMPORTANT_ASSETS;

export interface BalanceSummaryInput {
  coinType: string;
  totalBalance: string;
  coinObjectCount?: number;
}

export interface AddressBalanceInput {
  alias: string;
  address: string;
  balances: BalanceSummaryInput[];
}

export interface ImportantBalance {
  raw: bigint;
  display: string;
  coinObjectCount: number;
  coinType: string;
  readyForDeepbookPoolFee?: boolean;
}

export interface AddressInventorySummary {
  alias: string;
  address: string;
  coinTypeCount: number;
  important: Record<ImportantAsset, ImportantBalance>;
  balances: BalanceSummaryInput[];
}

export function formatUnits(raw: bigint, decimals: number): string {
  if (decimals === 0) return raw.toString();
  const scale = 10n ** BigInt(decimals);
  const whole = raw / scale;
  const frac = raw % scale;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(decimals, '0').replace(/0+$/, '')}`;
}

export function summarizeImportantBalances(input: AddressBalanceInput): AddressInventorySummary {
  const byType = new Map(input.balances.map((balance) => [balance.coinType, balance]));
  const important = Object.fromEntries(
    Object.entries(IMPORTANT_ASSETS).map(([label, asset]) => {
      const balance = byType.get(asset.coinType);
      const raw = BigInt(balance?.totalBalance ?? 0);
      const item: ImportantBalance = {
        raw,
        display: formatUnits(raw, asset.decimals),
        coinObjectCount: balance?.coinObjectCount ?? 0,
        coinType: asset.coinType,
      };
      if (label === 'DEEP') item.readyForDeepbookPoolFee = raw >= DEEPBOOK_POOL_CREATION_FEE;
      return [label, item];
    }),
  ) as Record<ImportantAsset, ImportantBalance>;

  return {
    alias: input.alias,
    address: input.address,
    coinTypeCount: input.balances.length,
    important,
    balances: input.balances,
  };
}

export function formatAddressInventory(summaries: AddressInventorySummary[]): string {
  const lines = ['address_summary\talias\taddress\tcoin_types\tsui\tpredict_dusdc\tstudio_lp\tdeep\tdbusdc'];
  for (const summary of summaries) {
    lines.push(
      [
        'address_summary',
        summary.alias,
        summary.address,
        summary.coinTypeCount.toString(),
        summary.important.SUI.display,
        summary.important.PREDICT_DUSDC.display,
        summary.important.STUDIO_LP.display,
        summary.important.DEEP.display,
        summary.important.DBUSDC.display,
      ].join('\t'),
    );
  }
  return lines.join('\n');
}
