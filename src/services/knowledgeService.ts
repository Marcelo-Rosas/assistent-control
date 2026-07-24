import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

export type KnowledgeGroup = {
  id: string;
  name: string;
  urls: Array<{ id: string; url: string; status: string }>;
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

    return (groups || []).map((g) => ({
      id: g.id,
      name: g.name,
      urls: (urls || [])
        .filter((u) => u.group_id === g.id)
        .map((u) => ({ id: u.id, url: u.url, status: u.status })),
    }));
  },

  async createGroup(name: string) {
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
    const supabase = requireClient();
    const { error } = await supabase.from('eros_knowledge_groups').delete().eq('id', id);
    if (error) throw error;
  },

  async addUrl(groupId: string, url: string) {
    if (!/^https?:\/\//i.test(url)) throw new Error('invalid_url');
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

  async ask(input: {
    groupId: string;
    messages: Array<{ role: string; content: string }>;
  }): Promise<{ text: string; provider?: string }> {
    const supabase = requireClient();
    const { data, error } = await supabase.functions.invoke('eros-knowledge-query', {
      body: input,
    });
    if (error) throw error;
    if (!data?.text) throw new Error(data?.error || 'empty_knowledge_response');
    return { text: String(data.text), provider: data.provider };
  },
};
