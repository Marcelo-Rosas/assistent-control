/// <reference path="../edge-runtime.d.ts" />
import { json } from '../_shared/cors.ts';
import { getServiceSupabase } from '../_shared/supabase.ts';
import {
  assertReasoning,
  normalizeFuguModel,
  sakanaResponses,
  type ReasoningEffort,
} from '../_shared/sakanaResponses.ts';

type PlaygroundBody = {
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  model?: string;
  reasoning_effort?: ReasoningEffort;
  web_search?: boolean;
  stream?: boolean;
};

function extractText(raw: any): string {
  if (typeof raw?.output_text === 'string') return raw.output_text;
  if (typeof raw?.choices?.[0]?.message?.content === 'string') return raw.choices[0].message.content;
  const out = raw?.output;
  if (Array.isArray(out)) {
    const parts: string[] = [];
    for (const item of out) {
      const content = item?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (typeof c?.text === 'string') parts.push(c.text);
        }
      }
    }
    if (parts.length) return parts.join('');
  }
  return '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true }, 200);
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const body = (await req.json().catch(() => null)) as PlaygroundBody | null;
  if (!body?.messages?.length) return json({ error: 'invalid_body' }, 400);

  let model;
  let effort: ReasoningEffort;
  try {
    model = normalizeFuguModel(body.model);
    effort = assertReasoning(model, body.reasoning_effort);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }

  let upstream: Response;
  try {
    upstream = await sakanaResponses({
      messages: body.messages,
      model,
      reasoning_effort: effort,
      web_search: !!body.web_search,
      stream: false,
    });
  } catch (e) {
    return json({ error: 'sakana_config', details: e instanceof Error ? e.message : String(e) }, 503);
  }

  const raw = await upstream.json().catch(() => ({}));
  if (!upstream.ok) return json({ error: 'sakana_failed', details: raw }, 502);

  const text = extractText(raw).trim();
  const usage = {
    input_tokens: raw?.usage?.input_tokens ?? null,
    output_tokens: raw?.usage?.output_tokens ?? null,
    orchestration_input_tokens: raw?.usage?.orchestration_input_tokens ?? null,
    orchestration_output_tokens: raw?.usage?.orchestration_output_tokens ?? null,
  };

  try {
    const supabase = getServiceSupabase();
    await supabase.from('eros_activity_log').insert({
      actor: 'eros-fugu-playground',
      action: 'playground_completion',
      entity_type: 'playground',
      entity_id: null,
      meta_json: { model, effort, usage },
    });
  } catch {
    /* ignore */
  }

  return json({ ok: true, text, model, usage });
});
