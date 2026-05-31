import { executeSponsoredMintTransaction } from '@/lib/enoki-server';

export async function POST(request: Request) {
  try {
    return Response.json(await executeSponsoredMintTransaction(await request.json()));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'execute failed';
    return Response.json({ error: message }, { status: message.includes('required') ? 400 : 500 });
  }
}
