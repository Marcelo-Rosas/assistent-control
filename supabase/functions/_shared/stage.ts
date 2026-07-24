/** Select-then-insert — avoid PostgREST onConflict on partial unique (company_id IS NULL). */
export async function ensurePipelineRow(supabase: any, leadId: string) {
  const { data, error } = await supabase
    .from('eros_pipeline')
    .select('id')
    .eq('lead_id', leadId)
    .is('company_id', null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.id) return;
  const { error: insertError } = await supabase
    .from('eros_pipeline')
    .insert({ lead_id: leadId, stage: 'new', position: 0 });
  if (insertError) throw new Error(insertError.message);
}

const SHARED = new Set(['new', 'qualifying', 'qualified', 'call', 'proposal', 'converted']);

/**
 * Prefer select-then-insert/update over upsert: PostgREST onConflict on the
 * partial unique `eros_pipeline_lead_global_uniq` (lead_id WHERE company_id IS NULL)
 * is awkward / unreliable.
 */
export async function setLeadStage(supabase: any, leadId: string, stage: string) {
  if (stage === 'discarded') {
    const { error } = await supabase.from('eros_leads').update({ status: 'discarded' }).eq('id', leadId);
    if (error) throw new Error(error.message);
    return;
  }
  if (!SHARED.has(stage)) throw new Error(`invalid_stage:${stage}`);
  const { error: leadError } = await supabase.from('eros_leads').update({ status: stage }).eq('id', leadId);
  if (leadError) throw new Error(leadError.message);

  const { data, error } = await supabase
    .from('eros_pipeline')
    .select('id')
    .eq('lead_id', leadId)
    .is('company_id', null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.id) {
    const { error: updateError } = await supabase
      .from('eros_pipeline')
      .update({ stage, position: 0 })
      .eq('id', data.id);
    if (updateError) throw new Error(updateError.message);
  } else {
    const { error: insertError } = await supabase
      .from('eros_pipeline')
      .insert({ lead_id: leadId, stage, position: 0 });
    if (insertError) throw new Error(insertError.message);
  }
}
