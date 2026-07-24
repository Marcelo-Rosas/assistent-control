import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

export type FuguModel = 'fugu' | 'fugu-ultra' | 'fugu-cyber';
export type ReasoningEffort = 'high' | 'xhigh' | 'max';

export type PlaygroundUsage = {
  input_tokens: number | null;
  output_tokens: number | null;
  orchestration_input_tokens: number | null;
  orchestration_output_tokens: number | null;
};

export type PlaygroundMessage = { role: 'user' | 'assistant' | 'system'; content: string };

export async function invokeFuguPlayground(input: {
  messages: PlaygroundMessage[];
  model: FuguModel;
  reasoning_effort: ReasoningEffort;
  web_search: boolean;
}): Promise<{ text: string; model: string; usage: PlaygroundUsage }> {
  if (!isSupabaseConfigured) throw new Error('SUPABASE_NOT_CONFIGURED');
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke('eros-fugu-playground', { body: input });
  if (error) throw error;
  if (!data?.text) throw new Error(data?.error || 'empty_playground_response');
  return {
    text: String(data.text),
    model: String(data.model || input.model),
    usage: data.usage || {
      input_tokens: null,
      output_tokens: null,
      orchestration_input_tokens: null,
      orchestration_output_tokens: null,
    },
  };
}
