import React, { useCallback, useEffect, useState } from 'react';
import { Save, Lock, Zap, Shield, Webhook, ShieldAlert, Loader2, Copy, Check } from 'lucide-react';
import { Button } from './Button';
import { useRoles } from '../context/RoleContext';
import { getSupabaseClient, isSupabaseConfigured } from '../services/supabaseClient';

type ChannelStatus = {
  ok: boolean;
  channel?: string;
  webhook_path?: string;
  evolution?: {
    configured?: boolean;
    url?: string;
    instance?: string;
    api_key_set?: boolean;
    state?: string | null;
    reason?: string;
    error?: string;
    http_status?: number;
  };
};

function defaultWebhookUrl() {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '');
  return base ? `${base}/functions/v1/eros-evolution-webhook` : '';
}

const Settings: React.FC = () => {
  const { currentRole, getRoleName } = useRoles();
  const isAdmin = currentRole === 'admin';

  const [webhookUrl, setWebhookUrl] = useState(defaultWebhookUrl);
  const [evolutionUrl, setEvolutionUrl] = useState('');
  const [evolutionInstance, setEvolutionInstance] = useState('');
  const [status, setStatus] = useState<ChannelStatus | null>(null);
  const [busy, setBusy] = useState<'load' | 'webhook' | 'evolution' | 'save' | null>(null);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const flash = (type: 'ok' | 'err', text: string) => {
    setToast({ type, text });
    window.setTimeout(() => setToast(null), 4500);
  };

  const loadStatus = useCallback(async () => {
    if (!isSupabaseConfigured || !isAdmin) return;
    setBusy('load');
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.functions.invoke('eros-channel-status', { body: {} });
      if (error) throw error;
      const payload = data as ChannelStatus;
      setStatus(payload);
      if (payload?.evolution?.url) setEvolutionUrl(payload.evolution.url);
      if (payload?.evolution?.instance) setEvolutionInstance(payload.evolution.instance);
      if (!webhookUrl && payload?.webhook_path) {
        const base = (import.meta.env.VITE_SUPABASE_URL as string)?.replace(/\/$/, '');
        if (base) setWebhookUrl(`${base}${payload.webhook_path}`);
      }
    } catch (e) {
      flash('err', `Status: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }, [isAdmin, webhookUrl]);

  useEffect(() => {
    void loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount / role
  }, [isAdmin]);

  const testWebhook = async () => {
    if (!webhookUrl.trim()) {
      flash('err', 'URL do webhook vazia');
      return;
    }
    setBusy('webhook');
    try {
      const resp = await fetch(webhookUrl.trim(), { method: 'GET' });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      if (body?.ok !== true) throw new Error(JSON.stringify(body));
      flash('ok', `Webhook OK — ${body.service || 'eros-evolution-webhook'} / channel=${body.channel}`);
    } catch (e) {
      flash('err', `Webhook falhou: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const testEvolution = async () => {
    if (!isSupabaseConfigured) {
      flash('err', 'Supabase não configurado no .env.local');
      return;
    }
    setBusy('evolution');
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.functions.invoke('eros-channel-status', { body: {} });
      if (error) throw error;
      const payload = data as ChannelStatus;
      setStatus(payload);
      if (payload?.evolution?.url) setEvolutionUrl(payload.evolution.url);
      if (payload?.evolution?.instance) setEvolutionInstance(payload.evolution.instance);

      if (!payload?.evolution?.configured) {
        flash('err', payload?.evolution?.reason || 'Evolution secrets ausentes no Edge');
        return;
      }
      const state = payload.evolution.state || 'unknown';
      if (payload.ok && state === 'open') {
        flash('ok', `Evolution OK — instance=${payload.evolution.instance} state=open`);
      } else if (payload.ok) {
        flash('ok', `Evolution responde — state=${state} (pareie QR se não for open)`);
      } else {
        flash('err', payload.evolution.error || `HTTP ${payload.evolution.http_status}`);
      }
    } catch (e) {
      flash('err', `Evolution: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const copyWebhook = async () => {
    if (!webhookUrl) return;
    await navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const saveNotes = async () => {
    // Secrets never leave Edge. Persist only UI notes / last-check in eros_config.
    if (!isSupabaseConfigured) {
      flash('err', 'Supabase não configurado');
      return;
    }
    setBusy('save');
    try {
      const supabase = getSupabaseClient();
      const value_json = {
        webhook_url: webhookUrl.trim(),
        display_evolution_url: evolutionUrl.trim() || null,
        display_instance: evolutionInstance.trim() || null,
        note: 'API keys só via Edge secrets / push-edge-secrets.ps1 — não gravar aqui',
        updated_at: new Date().toISOString(),
      };

      const { data: existing } = await supabase
        .from('eros_config')
        .select('id')
        .eq('key', 'channel_ui')
        .maybeSingle();

      if (existing?.id) {
        const { error } = await supabase.from('eros_config').update({ value_json }).eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('eros_config').insert({ key: 'channel_ui', value_json });
        if (error) throw error;
      }

      flash(
        'ok',
        'Preferências UI salvas. Chaves reais continuam só no Edge (EVOLUTION_* / push-edge-secrets.ps1).'
      );
      await loadStatus();
    } catch (e) {
      flash('err', `Salvar: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const evoState = status?.evolution?.state;
  const evoOk = status?.evolution?.configured && evoState === 'open';

  return (
    <div className="p-8 max-w-5xl mx-auto h-full overflow-y-auto bg-slate-950 text-slate-50 custom-scrollbar relative">
      <div className="mb-10 flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white">Configurações</h2>
          <p className="text-sm text-slate-400 mt-1">Central de controle da sua instância GymSite - Pipeline.</p>
        </div>
        <div className="flex gap-2">
          <span className="px-3 py-1 bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs rounded-full font-mono flex items-center">
            <Shield className="w-3 h-3 mr-1" /> Ambiente Seguro
          </span>
        </div>
      </div>

      {toast && (
        <div
          className={`mb-6 rounded-xl border px-4 py-3 text-sm ${
            toast.type === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-red-500/30 bg-red-500/10 text-red-300'
          }`}
        >
          {toast.text}
        </div>
      )}

      <div className="space-y-8 relative">
        {isAdmin && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 text-sm text-slate-300 space-y-2">
            <h3 className="font-bold text-white text-base">Edge Secrets (fonte da verdade)</h3>
            <p className="text-xs text-slate-400">
              Nunca grave API keys em `eros_config` nem com prefixo `VITE_`. Use `.env.local` +{' '}
              <code className="text-slate-200">.\scripts\push-edge-secrets.ps1</code>.
            </p>
            <ul className="text-xs font-mono text-slate-400 list-disc pl-5 space-y-1">
              <li>CHANNEL_PROVIDER=evolution</li>
              <li>EVOLUTION_URL / EVOLUTION_INSTANCE / EVOLUTION_API_KEY</li>
              <li>SAKANA_API_KEY / LLM_PROVIDER</li>
            </ul>
          </div>
        )}

        {!isAdmin && (
          <div className="absolute inset-x-[-12px] inset-y-[-12px] z-40 bg-slate-950/80 backdrop-blur-[6px] rounded-2xl border border-slate-800/40 p-8 flex flex-col items-center justify-center text-center">
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-full mb-6 animate-pulse">
              <ShieldAlert className="w-12 h-12 text-red-400" />
            </div>
            <h3 className="text-2xl font-bold text-white tracking-tight mb-2">Acesso Restrito ao Administrador</h3>
            <p className="text-sm text-slate-400 max-w-md leading-relaxed mb-6">
              Você está como <strong className="text-red-400 font-semibold">{getRoleName()}</strong>. Troque o simulador
              para <strong className="text-white">Administrador</strong>.
            </p>
          </div>
        )}

        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 backdrop-blur-sm shadow-xl p-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Zap className="w-32 h-32 text-cyan-500 rotate-12" />
          </div>

          <div className="flex items-start gap-5 mb-8 relative z-10">
            <div className="p-3 bg-cyan-500/10 border border-cyan-500/20 rounded-xl shadow-lg shadow-cyan-500/5">
              <Zap className="w-8 h-8 text-cyan-400" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white">Evolution API</h3>
              <p className="text-sm text-slate-400 mt-1">
                Status lido dos secrets Edge. Campos abaixo são espelho — editar não altera a API key.
              </p>
            </div>
          </div>

          <div className="grid gap-6 max-w-3xl relative z-10">
            <div className="grid gap-2">
              <label className="text-sm font-medium text-slate-300">API URL (Base URL)</label>
              <input
                type="text"
                disabled={!isAdmin}
                value={evolutionUrl}
                onChange={(e) => setEvolutionUrl(e.target.value)}
                placeholder="https://seu-host-evolution"
                className="flex h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 transition-all shadow-inner disabled:opacity-50"
              />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium text-slate-300">Instance</label>
              <input
                type="text"
                disabled={!isAdmin}
                value={evolutionInstance}
                onChange={(e) => setEvolutionInstance(e.target.value)}
                placeholder="gymsite"
                className="flex h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 disabled:opacity-50"
              />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium text-slate-300">API Key (Global)</label>
              <div className="relative group">
                <input
                  type="password"
                  value={status?.evolution?.api_key_set ? '••••••••••••••••••••••••' : ''}
                  readOnly
                  placeholder="Só no Edge secret EVOLUTION_API_KEY"
                  className="flex h-11 w-full rounded-lg border border-slate-700 bg-slate-950/50 px-4 py-2 text-sm text-slate-400 focus:outline-none cursor-not-allowed"
                />
                <Lock className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 mt-2">
              <div
                className={`flex items-center gap-3 border p-3 rounded-lg w-fit ${
                  evoOk
                    ? 'bg-emerald-500/10 border-emerald-500/20'
                    : status?.evolution?.configured
                      ? 'bg-amber-500/10 border-amber-500/20'
                      : 'bg-slate-800/50 border-slate-700'
                }`}
              >
                <span className="relative flex h-3 w-3">
                  {evoOk && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  )}
                  <span
                    className={`relative inline-flex rounded-full h-3 w-3 ${
                      evoOk ? 'bg-emerald-500' : status?.evolution?.configured ? 'bg-amber-400' : 'bg-slate-500'
                    }`}
                  ></span>
                </span>
                <span
                  className={`text-sm font-semibold ${
                    evoOk ? 'text-emerald-400' : status?.evolution?.configured ? 'text-amber-300' : 'text-slate-400'
                  }`}
                >
                  {busy === 'load' || busy === 'evolution'
                    ? 'Checando…'
                    : evoOk
                      ? 'Conexão open'
                      : status?.evolution?.configured
                        ? `State: ${evoState || '—'}`
                        : 'Secrets não configurados / status não carregado'}
                </span>
              </div>
              <Button
                disabled={!isAdmin || busy !== null}
                variant="secondary"
                onClick={() => void testEvolution()}
                className="bg-slate-800 border-slate-700"
              >
                {busy === 'evolution' ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Testar Evolution
              </Button>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 backdrop-blur-sm shadow-xl p-8">
          <div className="flex items-start gap-5 mb-8">
            <div className="p-3 bg-violet-500/10 border border-violet-500/20 rounded-xl shadow-lg shadow-violet-500/5">
              <Webhook className="w-8 h-8 text-violet-400" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white">Webhooks</h3>
              <p className="text-sm text-slate-400 mt-1">
                Cole esta URL no Evolution Manager (event `MESSAGES_UPSERT` + header `apikey`).
              </p>
            </div>
          </div>

          <div className="grid gap-6 max-w-3xl">
            <div className="grid gap-2">
              <label className="text-sm font-medium text-slate-300">Callback URL (GymSite Edge)</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  disabled={!isAdmin}
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  className="flex-1 h-11 rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-500/50 disabled:opacity-50"
                />
                <Button
                  type="button"
                  disabled={!isAdmin || !webhookUrl}
                  variant="secondary"
                  onClick={() => void copyWebhook()}
                  className="bg-slate-800 border-slate-700 shrink-0"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </Button>
                <Button
                  type="button"
                  disabled={!isAdmin || busy !== null}
                  variant="secondary"
                  onClick={() => void testWebhook()}
                  className="bg-slate-800 border-slate-700 text-slate-300 hover:text-white disabled:opacity-50 shrink-0"
                >
                  {busy === 'webhook' ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Testar
                </Button>
              </div>
              <p className="text-xs text-slate-500">GET health — Evolution manda POST real nos eventos.</p>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-4 pt-6 border-t border-slate-800">
          <Button
            variant="ghost"
            disabled={!isAdmin || busy !== null}
            onClick={() => void loadStatus()}
            className="text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-50"
          >
            Recarregar status
          </Button>
          <Button
            size="lg"
            disabled={!isAdmin || busy !== null}
            onClick={() => void saveNotes()}
            className="shadow-lg shadow-cyan-500/20 disabled:opacity-50"
          >
            {busy === 'save' ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Save className="w-5 h-5 mr-2" />}
            Salvar preferências UI
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Settings;
