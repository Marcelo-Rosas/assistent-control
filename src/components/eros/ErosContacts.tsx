import React, { useMemo, useState } from 'react';
import { Filter, Heart, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { useEros } from '../../hooks/useEros';
import { ErosChannel, ErosClassification, ErosLead } from '../../types';

type LeadForm = {
  name: string;
  channel: ErosChannel;
  username: string;
  phone: string;
  email: string;
  classification: ErosClassification;
  score: number;
  notes: string;
};

const emptyForm = (): LeadForm => ({
  name: '',
  channel: 'instagram',
  username: '',
  phone: '',
  email: '',
  classification: 'morno',
  score: 0,
  notes: '',
});

function fromLead(l: ErosLead): LeadForm {
  return {
    name: l.name,
    channel: l.channel,
    username: l.username || '',
    phone: l.phone || '',
    email: l.email || '',
    classification: l.classification,
    score: l.score,
    notes: l.notes || '',
  };
}

export const ErosContacts: React.FC = () => {
  const { leads, isLoading, error, needsSetup, createLead, updateLead, deleteLead } = useEros();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<ErosClassification | 'all'>('all');
  const [modal, setModal] = useState<'create' | 'edit' | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<LeadForm>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return leads.filter((l) => {
      if (filter !== 'all' && l.classification !== filter) return false;
      if (!query) return true;
      return (
        l.name.toLowerCase().includes(query) ||
        (l.username || '').toLowerCase().includes(query) ||
        (l.phone || '').toLowerCase().includes(query)
      );
    });
  }, [leads, q, filter]);

  const openCreate = () => {
    setForm(emptyForm());
    setEditingId(null);
    setLocalError(null);
    setModal('create');
  };

  const openEdit = (l: ErosLead) => {
    setForm(fromLead(l));
    setEditingId(l.id);
    setLocalError(null);
    setModal('edit');
  };

  const closeModal = () => {
    if (saving) return;
    setModal(null);
    setEditingId(null);
    setLocalError(null);
  };

  const onSave = async () => {
    if (!form.name.trim()) {
      setLocalError('Nome obrigatório');
      return;
    }
    setSaving(true);
    setLocalError(null);
    try {
      if (modal === 'create') {
        await createLead({
          name: form.name,
          channel: form.channel,
          username: form.username || null,
          phone: form.phone || null,
          email: form.email || null,
          classification: form.classification,
          score: form.score,
          notes: form.notes || null,
        });
      } else if (modal === 'edit' && editingId) {
        await updateLead(editingId, {
          name: form.name.trim(),
          channel: form.channel,
          username: form.username.trim() || null,
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          classification: form.classification,
          score: Math.min(100, Math.max(0, form.score)),
          notes: form.notes.trim() || null,
        });
      }
      setModal(null);
      setEditingId(null);
    } catch (e: any) {
      setLocalError(e?.message ?? 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (l: ErosLead) => {
    if (!window.confirm(`Excluir lead "${l.name}"?`)) return;
    setLocalError(null);
    try {
      await deleteLead(l.id);
    } catch (e: any) {
      setLocalError(e?.message ?? 'Falha ao excluir');
    }
  };

  return (
    <div className="h-full overflow-auto">
      <div className="p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Heart className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-50">Pipeline • Leads</h1>
              <p className="text-xs text-slate-400">CRUD leads sociais (IG/WhatsApp).</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!needsSetup && (
              <div className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold border bg-emerald-500/10 border-emerald-500/20 text-emerald-300">
                Supabase conectado
              </div>
            )}
            <button
              type="button"
              disabled={needsSetup}
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-cyan-600/90 hover:bg-cyan-500 text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus className="w-4 h-4" />
              Novo lead
            </button>
          </div>
        </div>

        {needsSetup && (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-100 text-sm">
            Configure <code className="text-amber-50">VITE_SUPABASE_URL</code> /{' '}
            <code className="text-amber-50">VITE_SUPABASE_ANON_KEY</code>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="lg:col-span-2 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por nome, @, telefone..."
              className="w-full h-11 pl-10 pr-3 rounded-xl bg-slate-950/40 border border-slate-800/70 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
            />
          </div>

          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as ErosClassification | 'all')}
              className="w-full h-11 pl-10 pr-3 rounded-xl bg-slate-950/40 border border-slate-800/70 text-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
            >
              <option value="all">Todos</option>
              <option value="hot">HOT</option>
              <option value="morno">Morno</option>
              <option value="frio">Frio</option>
            </select>
          </div>
        </div>

        {(error || localError) && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-sm">
            {localError || error}
          </div>
        )}

        <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 backdrop-blur-xl overflow-hidden">
          <div className="grid grid-cols-12 gap-0 px-4 py-3 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800/70">
            <div className="col-span-4">Lead</div>
            <div className="col-span-2">Canal</div>
            <div className="col-span-2">Classificação</div>
            <div className="col-span-1 text-right">Score</div>
            <div className="col-span-1 text-right">Status</div>
            <div className="col-span-2 text-right">Ações</div>
          </div>

          <div className="divide-y divide-slate-800/60">
            {isLoading && <div className="px-4 py-4 text-sm text-slate-400">Carregando…</div>}
            {!isLoading && !needsSetup && filtered.length === 0 && (
              <div className="px-4 py-4 text-sm text-slate-400">
                {leads.length === 0 ? 'Nenhum lead — crie o primeiro.' : 'Nenhum lead encontrado.'}
              </div>
            )}
            {!isLoading &&
              filtered.map((l) => (
                <div key={l.id} className="grid grid-cols-12 px-4 py-3 items-center hover:bg-slate-900/30">
                  <div className="col-span-4 flex items-center gap-3 min-w-0">
                    <img
                      src={l.avatar_url || 'https://placehold.co/64x64/0f172a/94a3b8?text=G'}
                      className="w-9 h-9 rounded-xl border border-slate-700/60 object-cover"
                      alt={l.name}
                      loading="lazy"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-100 truncate">{l.name}</div>
                      <div className="text-[11px] text-slate-400 truncate">
                        {l.username ? `@${l.username}` : l.phone || '—'}
                      </div>
                    </div>
                  </div>
                  <div className="col-span-2 text-sm text-slate-300 capitalize">{l.channel}</div>
                  <div className="col-span-2">
                    <span className={badgeClass(l.classification)}>{l.classification.toUpperCase()}</span>
                  </div>
                  <div className="col-span-1 text-sm text-slate-200 text-right">{l.score}</div>
                  <div className="col-span-1 text-sm text-slate-300 text-right truncate">{l.status}</div>
                  <div className="col-span-2 flex justify-end gap-1">
                    <button
                      type="button"
                      disabled={needsSetup}
                      onClick={() => openEdit(l)}
                      className="p-2 rounded-lg text-slate-300 hover:bg-slate-800/80 hover:text-cyan-200 disabled:opacity-40"
                      title="Editar"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      disabled={needsSetup}
                      onClick={() => void onDelete(l)}
                      className="p-2 rounded-lg text-slate-300 hover:bg-red-950/40 hover:text-red-300 disabled:opacity-40"
                      title="Excluir"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950 shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
              <h2 className="text-base font-semibold text-slate-50">
                {modal === 'create' ? 'Novo lead' : 'Editar lead'}
              </h2>
              <button
                type="button"
                onClick={closeModal}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              {localError && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-sm">
                  {localError}
                </div>
              )}

              <Field label="Nome *">
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className={inputClass}
                  autoFocus
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Canal">
                  <select
                    value={form.channel}
                    onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value as ErosChannel }))}
                    className={inputClass}
                  >
                    <option value="instagram">Instagram</option>
                    <option value="whatsapp">WhatsApp</option>
                  </select>
                </Field>
                <Field label="Classificação">
                  <select
                    value={form.classification}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, classification: e.target.value as ErosClassification }))
                    }
                    className={inputClass}
                  >
                    <option value="hot">HOT</option>
                    <option value="morno">Morno</option>
                    <option value="frio">Frio</option>
                  </select>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Username">
                  <input
                    value={form.username}
                    onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                    className={inputClass}
                    placeholder="sem @"
                  />
                </Field>
                <Field label="Score (0–100)">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={form.score}
                    onChange={(e) => setForm((f) => ({ ...f, score: Number(e.target.value) || 0 }))}
                    className={inputClass}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Telefone">
                  <input
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    className={inputClass}
                  />
                </Field>
                <Field label="Email">
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    className={inputClass}
                  />
                </Field>
              </div>

              <Field label="Notas">
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={3}
                  className={`${inputClass} resize-none`}
                />
              </Field>
            </div>

            <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-800">
              <button
                type="button"
                disabled={saving}
                onClick={closeModal}
                className="h-9 px-3 rounded-xl border border-slate-700 text-slate-300 text-sm hover:bg-slate-900"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void onSave()}
                className="h-9 px-4 rounded-xl bg-cyan-600/90 hover:bg-cyan-500 text-white text-sm font-medium disabled:opacity-50"
              >
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const inputClass =
  'w-full h-10 px-3 rounded-xl bg-slate-900/60 border border-slate-800 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/30';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] uppercase tracking-wider text-slate-400">{label}</span>
      {children}
    </label>
  );
}

function badgeClass(classification: string) {
  switch (classification) {
    case 'hot':
      return 'text-[10px] font-bold px-2 py-1 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-200';
    case 'frio':
      return 'text-[10px] font-bold px-2 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-200';
    default:
      return 'text-[10px] font-bold px-2 py-1 rounded-full bg-yellow-500/10 border border-yellow-500/20 text-yellow-200';
  }
}
