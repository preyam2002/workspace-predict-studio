import { PYTH_BTC_USD_FEED_ID, fetchPythNavAnchor } from '@/lib/pyth';

export async function GET() {
  try {
    return Response.json(await fetchPythNavAnchor(PYTH_BTC_USD_FEED_ID));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'pyth fetch failed';
    return Response.json({ error: message }, { status: 502 });
  }
}
