import { WALRUS_TESTNET_AGGREGATOR, WALRUS_TESTNET_PUBLISHER, getWalrusJson, putWalrusJson } from '@/lib/walrus';

const PUBLISHER = process.env.NEXT_PUBLIC_WALRUS_PUBLISHER ?? WALRUS_TESTNET_PUBLISHER;
const AGGREGATOR = process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR ?? WALRUS_TESTNET_AGGREGATOR;

export async function POST(request: Request) {
  try {
    return Response.json(await putWalrusJson(PUBLISHER, await request.json()));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'walrus put failed';
    return Response.json({ error: message }, { status: 502 });
  }
}

export async function GET(request: Request) {
  const blobId = new URL(request.url).searchParams.get('blobId');
  if (!blobId) return Response.json({ error: 'blobId is required' }, { status: 400 });
  try {
    return Response.json(await getWalrusJson(AGGREGATOR, blobId));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'walrus get failed';
    return Response.json({ error: message }, { status: 502 });
  }
}
