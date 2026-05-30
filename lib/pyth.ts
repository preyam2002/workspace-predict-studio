export interface PythPrice {
  price: string | number;
  expo: number;
  publishTime?: number;
  publish_time?: number;
  conf?: string | number;
}

export interface PythNavAnchor {
  price: number;
  confidence?: number;
  stale: boolean;
  publishTime?: number;
}

export function normalizePythPrice(price: PythPrice): number {
  return Number(price.price) * 10 ** price.expo;
}

export function normalizePythConfidence(price: PythPrice): number | undefined {
  return price.conf === undefined ? undefined : Number(price.conf) * 10 ** price.expo;
}

export function pythPublishTime(price: PythPrice): number | undefined {
  return price.publishTime ?? price.publish_time;
}

export function pythNavAnchor(price: PythPrice, nowSec: number, maxAgeSec = 60): PythNavAnchor {
  const publishTime = pythPublishTime(price);
  return {
    price: normalizePythPrice(price),
    confidence: normalizePythConfidence(price),
    stale: publishTime === undefined ? true : nowSec - publishTime > maxAgeSec,
    publishTime,
  };
}
