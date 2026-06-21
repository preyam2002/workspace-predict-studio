import { FLOAT, type OracleState } from './types';

function compactThousands(value: number) {
  return `${Math.round(value / 1_000)}k`;
}

export function defaultIntentPrompt(oracle: Pick<OracleState, 'underlyingAsset' | 'forward'>): string {
  const forwardUsd = oracle.forward / FLOAT;
  const lo = compactThousands(forwardUsd * 0.95);
  const hi = compactThousands(forwardUsd * 1.05);
  return `${oracle.underlyingAsset} stays between ${lo} and ${hi} through expiry`;
}
