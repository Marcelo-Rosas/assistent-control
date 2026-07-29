/// <reference path="../edge-runtime.d.ts" />
/**
 * Fresh ingest: wipe group chunks → embed → insert with content_hash + embedding.
 * JWT tenant gate only (app_metadata.company_id). No reuse of prior chunk rows.
 */
import { json } from '../_shared/cors.ts';
import { getServiceSupabase } from '../_shared/supabase.ts';
import { embedDocuments } from '../_shared/embed.ts';
import { contentHash, resolveUserCompanyIdFromJwt } from '../_shared/tenant.ts';

type InChunk = {
  chunk_id: string;
  chunk_type: string;
  text: string;
  meta?: Record<string, unknown>;
  source_kind?: string;
  source_ref?: string | null;
  section_path?: string | null;
};

type Body = {
  groupId: string;
  name?: string;
  systemPrompt?: string;
  chunks: InChunk[];
  sourceRefs?: string[];
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true }, 200);
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.groupId || !Array.isArray(body.chunks) || !body.chunks.length) {
    return json({ error: 'invalid_body' }, 400);
  }

  const userCompanyId = await resolveUserCompanyIdFromJwt(req);
  const supabase = getServiceSupabase();

  const { data: group, error: groupErr } = await supabase
    .from('eros_knowledge_groups')
    .select('id, company_id, name')
    .eq('id', body.groupId)
    .maybeSingle();

  if (groupErr) return json({ error: 'group_lookup_failed', details: groupErr.message }, 500);
  if (!group) return json({ error: 'group_not_found' }, 404);

  if (userCompanyId && group.company_id && userCompanyId !== group.company_id) {
    return json({ error: 'forbidden_tenant', details: 'group_company_mismatch' }, 403);
  }

  // Fresh start for this group — do not reuse prior rows
  const { error: delErr } = await supabase
    .from('eros_knowledge_chunks')
    .delete()
    .eq('group_id', body.groupId);
  if (delErr) return json({ error: 'chunk_wipe_failed', details: delErr.message }, 500);

  const tenantId = group.company_id ?? null;
  const texts = body.chunks.map((c) => c.text);

  let embeddings: number[][];
  let embedConfig: { provider: string; model: string; version: string };
  try {
    const embedded = await embedDocuments(texts, supabase);
    embeddings = embedded.embeddings;
    embedConfig = embedded.config;
  } catch (e) {
    return json(
      {
        error: 'embed_failed',
        details: e instanceof Error ? e.message : String(e),
        hint: 'Set VOYAGE_API_KEY (or OPENAI_API_KEY) on Edge secrets',
      },
      502,
    );
  }

  if (embeddings.length !== body.chunks.length) {
    return json(
      {
        error: 'embed_count_mismatch',
        details: `expected_${body.chunks.length}_got_${embeddings.length}`,
      },
      502,
    );
  }

  const rows = [];
  for (let i = 0; i < body.chunks.length; i++) {
    const c = body.chunks[i];
    const chunkType = c.chunk_type || 'text';
    const hash = await contentHash(body.groupId, chunkType, c.text);
    const sectionPath =
      c.section_path ||
      (typeof c.meta?.section_path === 'string' ? c.meta.section_path : null);
    rows.push({
      group_id: body.groupId,
      document_id: null,
      tenant_id: tenantId,
      source_kind: c.source_kind || String(c.meta?.domain || 'generic'),
      source_ref: c.source_ref ?? body.sourceRefs?.[0] ?? null,
      chunk_id: c.chunk_id,
      chunk_type: chunkType,
      text: c.text,
      meta: { ...(c.meta || {}), chunking: 'chunking-v1' },
      section_path: sectionPath,
      content_hash: hash,
      embedding_model: `${embedConfig.provider}:${embedConfig.model}`,
      embedding_version: embedConfig.version,
      access_level: 'internal',
      embedding: embeddings[i],
    });
  }

  // Idempotent within this insert batch (same hash twice → keep first)
  const seen = new Set<string>();
  const uniqueRows = rows.filter((r) => {
    if (seen.has(r.content_hash)) return false;
    seen.add(r.content_hash);
    return true;
  });

  // Upsert batches — content_hash unique (group_id, content_hash)
  const BATCH = 50;
  for (let i = 0; i < uniqueRows.length; i += BATCH) {
    const batch = uniqueRows.slice(i, i + BATCH);
    const { error: insErr } = await supabase.from('eros_knowledge_chunks').upsert(batch, {
      onConflict: 'group_id,content_hash',
    });
    if (insErr) {
      return json(
        { error: 'chunk_insert_failed', details: insErr.message, batch: Math.floor(i / BATCH) },
        500,
      );
    }
  }

  const { error: agentErr } = await supabase.from('eros_knowledge_agents').upsert(
    {
      group_id: body.groupId,
      name: body.name || group.name || 'GymSite Knowledge',
      status: 'published',
      system_prompt: body.systemPrompt || null,
      chunk_count: uniqueRows.length,
      last_trained_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'group_id' },
  );
  if (agentErr) return json({ error: 'agent_upsert_failed', details: agentErr.message }, 500);

  await supabase
    .from('eros_knowledge_urls')
    .update({ status: 'synced' })
    .eq('group_id', body.groupId);

  return json({
    ok: true,
    chunk_count: uniqueRows.length,
    embedding_model: `${embedConfig.provider}:${embedConfig.model}@${embedConfig.version}`,
    tenant_id: tenantId,
  });
});
