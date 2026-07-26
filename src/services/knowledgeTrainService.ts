/**
 * Train & publish — domínio-agnóstico (GP / TP / WH / regulatório / genérico).
 * Upload JSON de qualquer schema conhecido; default = seeds em /knowledge/*.
 */
import { answerFromKnowledge } from '../lib/knowledgeAnswer';
import {
  buildChunksFromPayload,
  domainsInChunks,
} from '../lib/knowledgeIndex';
import { GLOBAL_SYSTEM, type KnowledgeChunk } from '../lib/knowledgeTypes';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

const LS_PREFIX = 'gymsite_knowledge_agent:';

export type PublishedAgent = {
  groupId: string;
  name: string;
  status: 'draft' | 'training' | 'published' | 'error';
  system_prompt: string;
  chunk_count: number;
  last_trained_at: string | null;
  last_error: string | null;
  chunks: KnowledgeChunk[];
  source_refs: string[];
  domains: string[];
};

function lsKey(groupId: string) {
  return `${LS_PREFIX}${groupId}`;
}

export function loadLocalAgent(groupId: string): PublishedAgent | null {
  try {
    const raw = localStorage.getItem(lsKey(groupId));
    if (!raw) return null;
    return JSON.parse(raw) as PublishedAgent;
  } catch {
    return null;
  }
}

export function saveLocalAgent(agent: PublishedAgent) {
  localStorage.setItem(lsKey(agent.groupId), JSON.stringify(agent));
}

export function clearLocalAgent(groupId?: string) {
  if (groupId) {
    localStorage.removeItem(lsKey(groupId));
    return;
  }
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(LS_PREFIX)) keys.push(k);
  }
  for (const k of keys) localStorage.removeItem(k);
}

/** Só sinaliza seed GP sintético sem plano — não aplica a TP/regulatório. */
export function agentMissingPlans(agent: PublishedAgent | null): boolean {
  if (!agent?.chunks?.length) return false;
  const gyms = agent.chunks.filter((c) => c.chunk_type === 'gp_gym');
  if (!gyms.length) return false;
  const hasOther = agent.chunks.some(
    (c) => c.chunk_type === 'tp_partner' || c.chunk_type === 'law_chunk',
  );
  if (hasOther) return false;
  return !gyms.some((c) => {
    const m = c.meta || {};
    return m.plano_minimo != null || m.creditos_minimos != null || m.valor_mensal_brl != null;
  });
}

const DEFAULT_SEEDS = [
  '/knowledge/gp-accept-fortaleza.json',
  '/knowledge/tp-partner-enrich-coco.json',
  '/knowledge/gp-artifact-fortaleza.json',
];

/** Carrega todos os seeds públicos disponíveis (merge multi-domínio). */
export async function fetchDefaultSeeds(): Promise<Array<{ payload: unknown; ref: string }>> {
  const out: Array<{ payload: unknown; ref: string }> = [];
  for (const p of DEFAULT_SEEDS) {
    try {
      const res = await fetch(p);
      if (!res.ok) continue;
      out.push({ payload: await res.json(), ref: p });
    } catch {
      /* skip missing */
    }
  }
  if (!out.length) throw new Error('knowledge_seeds_missing — coloque JSON em public/knowledge/');
  return out;
}

export async function trainAndPublish(input: {
  groupId: string;
  name?: string;
  /** Um JSON (upload). Se omitido, merge de todos seeds /knowledge/*. */
  payload?: unknown;
  sourceRef?: string;
  /** Merge adicional de payloads (ex. GP+TP). */
  extraPayloads?: Array<{ payload: unknown; ref: string }>;
}): Promise<PublishedAgent> {
  const { groupId } = input;
  const sources: Array<{ payload: unknown; ref: string }> = [];

  if (input.payload) {
    sources.push({ payload: input.payload, ref: input.sourceRef || 'upload' });
  } else {
    sources.push(...(await fetchDefaultSeeds()));
  }
  if (input.extraPayloads?.length) sources.push(...input.extraPayloads);

  const allChunks: KnowledgeChunk[] = [];
  const refs: string[] = [];
  for (const s of sources) {
    const { chunks } = buildChunksFromPayload(s.payload, s.ref);
    // GP sintético sem plano: pula esse source, não aborta train global
    const gpGyms = chunks.filter((c) => c.chunk_type === 'gp_gym');
    if (gpGyms.length) {
      const withPlan = gpGyms.filter((c) => {
        const m = c.meta || {};
        return m.plano_minimo != null || m.creditos_minimos != null || m.valor_mensal_brl != null;
      });
      if (!withPlan.length) continue;
    }
    if (!chunks.length) continue;
    allChunks.push(...chunks);
    refs.push(s.ref);
  }

  if (!allChunks.length) {
    throw new Error(
      'train_empty — nenhum chunk. Use JSON GP (academias), TP (partners), ou regulatório (pages/laws).',
    );
  }

  // Dedupe chunk_id
  const seen = new Set<string>();
  const chunks = allChunks.filter((c) => {
    if (seen.has(c.chunk_id)) return false;
    seen.add(c.chunk_id);
    return true;
  });

  const domains = domainsInChunks(chunks);
  const agent: PublishedAgent = {
    groupId,
    name: input.name || `GymSite Knowledge [${domains.join('+') || 'generic'}]`,
    status: 'published',
    system_prompt: GLOBAL_SYSTEM,
    chunk_count: chunks.length,
    last_trained_at: new Date().toISOString(),
    last_error: null,
    chunks,
    source_refs: refs,
    domains,
  };

  saveLocalAgent(agent);

  if (isSupabaseConfigured) {
    try {
      await syncAgentToSupabase(agent);
    } catch (e) {
      agent.last_error = `supabase_sync_failed: ${e instanceof Error ? e.message : String(e)}`;
      saveLocalAgent(agent);
    }
  }

  return agent;
}

async function syncAgentToSupabase(agent: PublishedAgent) {
  const supabase = getSupabaseClient();

  await supabase.from('eros_knowledge_chunks').delete().eq('group_id', agent.groupId);

  const rows = agent.chunks.map((c) => ({
    group_id: agent.groupId,
    source_kind: String(c.meta?.domain || 'generic'),
    source_ref: agent.source_refs[0] || null,
    chunk_id: c.chunk_id,
    chunk_type: c.chunk_type,
    text: c.text,
    meta: c.meta || {},
  }));

  const { error: chunkErr } = await supabase.from('eros_knowledge_chunks').insert(rows);
  if (chunkErr) throw chunkErr;

  const { error: agentErr } = await supabase.from('eros_knowledge_agents').upsert(
    {
      group_id: agent.groupId,
      name: agent.name,
      status: 'published',
      system_prompt: agent.system_prompt,
      chunk_count: agent.chunk_count,
      last_trained_at: agent.last_trained_at,
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'group_id' },
  );
  if (agentErr) throw agentErr;

  await supabase
    .from('eros_knowledge_urls')
    .update({ status: 'synced' })
    .eq('group_id', agent.groupId);
}

export function askPublishedAgent(
  groupId: string,
  question: string,
): { text: string; provider: string } | null {
  const agent = loadLocalAgent(groupId);
  if (!agent || agent.status !== 'published' || !agent.chunks.length) return null;
  return answerFromKnowledge(question, agent.chunks);
}

export async function ensureLocalGroup(name: string): Promise<{ id: string; name: string }> {
  const key = 'gymsite_knowledge_local_groups';
  const raw = localStorage.getItem(key);
  const groups: Array<{ id: string; name: string }> = raw ? JSON.parse(raw) : [];
  const existing = groups.find((g) => g.name === name);
  if (existing) return existing;
  const g = { id: `local-${crypto.randomUUID()}`, name };
  groups.push(g);
  localStorage.setItem(key, JSON.stringify(groups));
  return g;
}

export function listLocalGroups(): Array<{ id: string; name: string }> {
  try {
    const raw = localStorage.getItem('gymsite_knowledge_local_groups');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
