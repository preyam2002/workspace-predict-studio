import { cetusMarketConfigFromEnv, createCetusSdk, mockCetusSecondaryPrice, readCetusSecondaryPrice } from '@/lib/cetus';

export async function GET() {
  const config = cetusMarketConfigFromEnv(process.env);
  if (!config) return Response.json(mockCetusSecondaryPrice());

  try {
    const sdk = await createCetusSdk(config.env);
    return Response.json(await readCetusSecondaryPrice(config, sdk));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'cetus secondary price failed';
    return Response.json({ error: message }, { status: 502 });
  }
}
