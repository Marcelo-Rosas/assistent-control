export type LlmProvider = 'gemini' | 'openai' | 'sakana' | 'ollama';

export type CallLlmResult = {
  text: string;
  provider: LlmProvider;
  model: string;
};

type OpenAiCompatOpts = {
  provider: LlmProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
};

const ALLOWED_PROVIDERS = new Set<string>(['sakana', 'ollama', 'gemini', 'openai']);

function withTimeout(ms: number): AbortSignal {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

async function openAiCompat(opts: OpenAiCompatOpts): Promise<CallLlmResult> {
  const base = opts.baseUrl.replace(/\/$/, '');
  const url = `${base}/chat/completions`;
  const timeoutMs = opts.timeoutMs ?? 60_000;

  const resp = await fetch(url, {
    method: 'POST',
    signal: withTimeout(timeoutMs),
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      temperature: opts.temperature ?? 0.6,
      max_tokens: opts.maxTokens ?? 256,
      messages: [
        {
          role: 'system',
          content: opts.system || 'Você é um assistente comercial SPIN, curto e objetivo.',
        },
        { role: 'user', content: opts.prompt },
      ],
    }),
  });

  const jsonResp = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`${opts.provider} error: ${JSON.stringify(jsonResp)}`);
  }

  const text = jsonResp?.choices?.[0]?.message?.content ?? '';
  return { text: String(text).trim(), provider: opts.provider, model: opts.model };
}

async function callGemini(prompt: string): Promise<CallLlmResult> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.6-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const resp = await fetch(url, {
    method: 'POST',
    signal: withTimeout(60_000),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: 256,
      },
    }),
  });

  const jsonResp = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`Gemini error: ${JSON.stringify(jsonResp)}`);
  }

  const text =
    jsonResp?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p?.text).filter(Boolean).join('') ||
    '';
  return { text: String(text).trim(), provider: 'gemini', model };
}

/** Resolve provider: eros_config.llm_provider → LLM_PROVIDER env → sakana. Config shape: `{ "provider": "sakana" }`. */
export async function resolveLlmProvider(supabase: any): Promise<LlmProvider> {
  const { data } = await supabase
    .from('eros_config')
    .select('value_json')
    .eq('key', 'llm_provider')
    .is('company_id', null)
    .maybeSingle();
  const fromConfig = String(data?.value_json?.provider || data?.value_json || '').toLowerCase();
  if (ALLOWED_PROVIDERS.has(fromConfig)) return fromConfig as LlmProvider;
  const fromEnv = (Deno.env.get('LLM_PROVIDER') || 'sakana').toLowerCase();
  const normalized = fromEnv === 'fugu' ? 'sakana' : fromEnv;
  return (ALLOWED_PROVIDERS.has(normalized) ? normalized : 'sakana') as LlmProvider;
}

/** sakana | ollama | gemini | openai — default sakana when provider omitted */
export async function callLlm(prompt: string, provider?: LlmProvider): Promise<CallLlmResult> {
  const raw = (provider || Deno.env.get('LLM_PROVIDER') || 'sakana').toLowerCase();
  const normalized = raw === 'fugu' ? 'sakana' : raw;
  const p = (ALLOWED_PROVIDERS.has(normalized) ? normalized : 'sakana') as LlmProvider;

  switch (p) {
    case 'openai': {
      const apiKey = Deno.env.get('OPENAI_API_KEY');
      if (!apiKey) throw new Error('OPENAI_API_KEY not set');
      return openAiCompat({
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey,
        model: Deno.env.get('OPENAI_MODEL') || 'gpt-4o-mini',
        prompt,
      });
    }
    case 'sakana': {
      const apiKey = Deno.env.get('SAKANA_API_KEY');
      if (!apiKey) throw new Error('SAKANA_API_KEY not set');
      return openAiCompat({
        provider: 'sakana',
        baseUrl: Deno.env.get('SAKANA_BASE_URL') || 'https://api.sakana.ai/v1',
        apiKey,
        model: Deno.env.get('SAKANA_MODEL') || 'fugu',
        prompt,
        timeoutMs: Number(Deno.env.get('SAKANA_TIMEOUT_MS') || 120_000),
      });
    }
    case 'ollama': {
      const baseUrl = Deno.env.get('OLLAMA_BASE_URL') || 'http://127.0.0.1:11434/v1';
      const apiKey = Deno.env.get('OLLAMA_API_KEY') || 'ollama';
      return openAiCompat({
        provider: 'ollama',
        baseUrl,
        apiKey,
        model: Deno.env.get('OLLAMA_MODEL') || 'llama3.2',
        prompt,
        timeoutMs: Number(Deno.env.get('OLLAMA_TIMEOUT_MS') || 120_000),
      });
    }
    case 'gemini':
    default:
      return callGemini(prompt);
  }
}
