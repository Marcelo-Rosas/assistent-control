import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';
import {
  askPublishedAgent,
  ensureLocalGroup,
  listLocalGroups,
  loadLocalAgent,
  trainAndPublish,
  type PublishedAgent,
} from './knowledgeTrainService';

export type KnowledgeGroup = {
  id: string;
  name: string;
  urls: Array<{ id: string; url: string; status: string }>;
  local?: boolean;
};

export type KnowledgeFile = {
  id: string;
  name: string;
  size_bytes: number;
  status: string;
};

function requireClient() {
  if (!isSupabaseConfigured) throw new Error('SUPABASE_NOT_CONFIGURED');
  return getSupabaseClient();
}

export const knowledgeService = {
  get configured() {
    return isSupabaseConfigured;
  },

  async listGroups(): Promise<KnowledgeGroup[]> {
    const local = listLocalGroups().map((g) => ({
      id: g.id,
      name: g.name,
      urls: [] as KnowledgeGroup['urls'],
      local: true,
    }));

    if (!isSupabaseConfigured) return local;

    try {
      const supabase = requireClient();
      const { data: groups, error } = await supabase
        .from('eros_knowledge_groups')
        .select('id, name')
        .order('created_at', { ascending: true });
      if (error) throw error;

      const { data: urls, error: urlErr } = await supabase
        .from('eros_knowledge_urls')
        .select('id, group_id, url, status');
      if (urlErr) throw urlErr;

      const remote: KnowledgeGroup[] = (groups || []).map((g) => ({
        id: g.id,
        name: g.name,
        urls: (urls || [])
          .filter((u) => u.group_id === g.id)
          .map((u) => ({ id: u.id, url: u.url, status: u.status })),
        local: false,
      }));

      // Prefer remote; append local-only ids not in remote
      const remoteIds = new Set(remote.map((r) => r.id));
      return [...remote, ...local.filter((l) => !remoteIds.has(l.id))];
    } catch {
      return local;
    }
  },

  async createGroup(name: string) {
    if (!isSupabaseConfigured) {
      return ensureLocalGroup(name);
    }
    const supabase = requireClient();
    const { data, error } = await supabase
      .from('eros_knowledge_groups')
      .insert({ name })
      .select('id, name')
      .single();
    if (error) throw error;
    return data;
  },

  async deleteGroup(id: string) {
    if (id.startsWith('local-')) {
      const key = 'gymsite_knowledge_local_groups';
      const groups = listLocalGroups().filter((g) => g.id !== id);
      localStorage.setItem(key, JSON.stringify(groups));
      localStorage.removeItem(`gymsite_knowledge_agent:${id}`);
      return;
    }
    const supabase = requireClient();
    const { error } = await supabase.from('eros_knowledge_groups').delete().eq('id', id);
    if (error) throw error;
  },

  async addUrl(groupId: string, url: string) {
    if (!/^https?:\/\//i.test(url)) throw new Error('invalid_url');
    if (groupId.startsWith('local-') || !isSupabaseConfigured) {
      throw new Error('URLs remotas exigem Supabase — use Treinar com fixture GP');
    }
    const supabase = requireClient();
    const { error } = await supabase.from('eros_knowledge_urls').insert({
      group_id: groupId,
      url,
      status: 'pending',
    });
    if (error) throw error;
  },

  async removeUrl(id: string) {
    const supabase = requireClient();
    const { error } = await supabase.from('eros_knowledge_urls').delete().eq('id', id);
    if (error) throw error;
  },

  async listFiles(): Promise<KnowledgeFile[]> {
    if (!isSupabaseConfigured) return [];
    const supabase = requireClient();
    const { data, error } = await supabase
      .from('eros_knowledge_files')
      .select('id, name, size_bytes, status')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []) as KnowledgeFile[];
  },

  async addFileMeta(input: { name: string; size_bytes: number; mime?: string }) {
    const supabase = requireClient();
    const { error } = await supabase.from('eros_knowledge_files').insert({
      name: input.name,
      size_bytes: input.size_bytes,
      mime: input.mime || null,
      status: 'pending',
    });
    if (error) throw error;
  },

  async deleteFile(id: string) {
    const supabase = requireClient();
    const { error } = await supabase.from('eros_knowledge_files').delete().eq('id', id);
    if (error) throw error;
  },

  getPublishedAgent(groupId: string): PublishedAgent | null {
    return loadLocalAgent(groupId);
  },

  async trainAndPublish(input: {
    groupId: string;
    name?: string;
    payload?: unknown;
    sourceRef?: string;
  }) {
    return trainAndPublish(input);
  },

  async ask(input: {
    groupId: string;
    messages: Array<{ role: string; content: string }>;
    /** Prefer camelCase; snake_case aliases accepted for prompts/clients. */
    topK?: number;
    top_k?: number;
    minSimilarity?: number;
    min_similarity?: number;
    modalidade?: string;
    bairro?: string;
    municipio?: string;
    plano_rank?: number;
    /** When true, Edge returns debug_prompt (header x-rag-include-debug). */
    includeDebug?: boolean;
  }): Promise<{
    text: string;
    provider?: string;
    sources?: Array<{
      chunk_id: string;
      score: number;
      url?: string | null;
      section?: string | null;
      nome_academia?: string | null;
      bairro?: string | null;
      municipios?: string[];
      modalidade?: string | null;
      plano_minimo?: string | null;
      warning?: string | null;
      source_ref?: string | null;
    }>;
    agent_status?: string | null;
    chunk_count?: number;
    retrieval?: string;
    debug_prompt?: string;
  }> {
    const lastUser = [...input.messages].reverse().find((m) => m.role === 'user');
    const question = lastUser?.content?.trim() || '';

    // Local mock only when Supabase not configured
    if (!isSupabaseConfigured) {
      const local = askPublishedAgent(input.groupId, question);
      if (local) return { ...local, sources: [] };
      throw new Error('Agente não publicado. Clique em Treinar & Publicar Agente.');
    }

    const topK = input.topK ?? input.top_k;
    const minSimilarity = input.minSimilarity ?? input.min_similarity;

    const supabase = requireClient();
    const { data, error } = await supabase.functions.invoke('knowledge-ask', {
      body: {
        groupId: input.groupId,
        messages: input.messages,
        top_k: topK,
        min_similarity: minSimilarity,
        modalidade: input.modalidade,
        bairro: input.bairro,
        municipio: input.municipio,
        plano_rank: input.plano_rank,
      },
      headers: input.includeDebug ? { 'x-rag-include-debug': 'true' } : undefined,
    });
    if (error) throw error;
    if (data?.error === 'forbidden' || data?.error === 'forbidden_tenant') {
      throw new Error('Acesso negado a este grupo (tenant).');
    }
    if (data?.error === 'agent_not_published') {
      throw new Error('Agente não publicado — rode ingestão TP + embed:tp.');
    }
    if (data?.error === 'embedding_failed' || data?.error === 'embed_query_failed') {
      throw new Error(
        data.hint || data.details || 'Falha ao embedar pergunta (OLLAMA/VOYAGE no Edge?)',
      );
    }
    if (data?.error === 'retrieval_failed') {
      throw new Error(data.details || 'Falha na busca vetorial');
    }
    if (!data?.text) throw new Error(data?.error || 'empty_knowledge_response');
    return {
      text: String(data.text),
      provider: data.provider,
      sources: Array.isArray(data.sources) ? data.sources : [],
      agent_status: data.agent_status ?? null,
      chunk_count: typeof data.chunk_count === 'number' ? data.chunk_count : undefined,
      retrieval: data.retrieval,
      debug_prompt: typeof data.debug_prompt === 'string' ? data.debug_prompt : undefined,
    };
  },
};
