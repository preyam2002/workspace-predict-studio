import { createIntentFromPrompt } from '@/lib/ai-intent';
import type { OracleState } from '@/lib/types';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { prompt?: unknown; oracle?: unknown };
    if (typeof body.prompt !== 'string' || body.prompt.trim().length === 0) {
      return Response.json({ error: 'prompt is required' }, { status: 400 });
    }
    if (!body.oracle || typeof body.oracle !== 'object') {
      return Response.json({ error: 'oracle is required' }, { status: 400 });
    }

    return Response.json(await createIntentFromPrompt({ prompt: body.prompt, oracle: body.oracle as OracleState }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'intent generation failed';
    return Response.json({ error: message }, { status: 422 });
  }
}
