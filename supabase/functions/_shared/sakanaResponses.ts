export type FuguModel = 'fugu' | 'fugu-ultra' | 'fugu-cyber';
export type ReasoningEffort = 'high' | 'xhigh' | 'max';

export function normalizeFuguModel(raw?: string): FuguModel {
  const v = (raw || 'fugu').toLowerCase();
  if (v === 'fugu-ultra-v1.1' || v === 'fugu-ultra') return 'fugu-ultra';
  if (v === 'fugu-cyber') return 'fugu-cyber';
  return 'fugu';
}

export function assertReasoning(model: FuguModel, effort?: ReasoningEffort): ReasoningEffort {
  const e = effort || 'high';
  if (e === 'max' && model !== 'fugu-ultra') {
    throw new Error('reasoning_effort max requires fugu-ultra');
  }
  return e;
}

export async function sakanaResponses(input: {
  messages: Array<{ role: string; content: string }>;
  model: FuguModel;
  reasoning_effort: ReasoningEffort;
  web_search?: boolean;
  stream?: boolean;
}): Promise<Response> {
  const apiKey = Deno.env.get('SAKANA_API_KEY');
  if (!apiKey) throw new Error('SAKANA_API_KEY not set');
  const base = (Deno.env.get('SAKANA_BASE_URL') || 'https://api.sakana.ai/v1').replace(/\/$/, '');
  const timeoutMs = Number(Deno.env.get('SAKANA_TIMEOUT_MS') || 120_000);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  const body: Record<string, unknown> = {
    model: input.model,
    input: input.messages.map((m) => ({ role: m.role, content: m.content })),
    reasoning: { effort: input.reasoning_effort },
    stream: !!input.stream,
  };
  if (input.web_search) body.tools = [{ type: 'web_search' }];

  try {
    return await fetch(`${base}/responses`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } finally {
    clearTimeout(t);
  }
}
