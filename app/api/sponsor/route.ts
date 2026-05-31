import { createSponsoredMintTransaction } from '@/lib/enoki-server';

export async function POST(request: Request) {
  try {
    return Response.json(await createSponsoredMintTransaction(await request.json()));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'sponsor failed';
    return Response.json({ error: message }, { status: message.includes('required') ? 400 : 500 });
  }
}
