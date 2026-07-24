/** Select-then-insert — avoid PostgREST onConflict on partial unique (company_id IS NULL). */
export async function ensurePipelineRow(supabase: any, leadId: string) {
  const { data } = await supabase.from('eros_pipeline').select('id').eq('lead_id', leadId).maybeSingle();
  if (data?.id) return;
  await supabase.from('eros_pipeline').insert({ lead_id: leadId, stage: 'new', position: 0 });
}

const SHARED = new Set(['new', 'qualifying', 'qualified', 'call', 'proposal', 'converted']);

/**
 * Prefer select-then-insert/update over upsert: PostgREST onConflict on the
 * partial unique `eros_pipeline_lead_global_uniq` (lead_id WHERE company_id IS NULL)
 * is awkward / unreliable.
 */
export async function setLeadStage(supabase: any, leadId: string, stage: string) {
  if (stage === 'discarded') {
    await supabase.from('eros_leads').update({ status: 'discarded' }).eq('id', leadId);
    return;
  }
  if (!SHARED.has(stage)) throw new Error(`invalid_stage:${stage}`);
  await supabase.from('eros_leads').update({ status: stage }).eq('id', leadId);

  const { data } = await supabase.from('eros_pipeline').select('id').eq('lead_id', leadId).maybeSingle();
  if (data?.id) {
    await supabase.from('eros_pipeline').update({ stage, position: 0 }).eq('id', data.id);
  } else {
    await supabase.from('eros_pipeline').insert({ lead_id: leadId, stage, position: 0 });
  }
}
