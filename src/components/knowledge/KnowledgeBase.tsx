import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Database,
  Globe,
  Plus,
  Trash2,
  Send,
  Loader2,
  AlertCircle,
  Rocket,
  CheckCircle2,
  Upload,
} from 'lucide-react';
import { useRoles } from '../../context/RoleContext';
import { Button } from '../Button';
import { knowledgeService, KnowledgeFile, KnowledgeGroup } from '../../services/knowledgeService';
import { PublishedAgent, agentMissingPlans, clearLocalAgent } from '../../services/knowledgeTrainService';
import { isSupabaseConfigured } from '../../services/supabaseClient';

type ChatMsg = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  sources?: Array<{
    chunk_id: string;
    score: number;
    url?: string | null;
    section?: string | null;
  }>;
};

export const KnowledgeBase: React.FC = () => {
  const { hasPermission } = useRoles();
  const canManage = hasPermission('manage_knowledge') || hasPermission('manage_settings');
  const canChat = hasPermission('interact_chat') || canManage;

  const [groups, setGroups] = useState<KnowledgeGroup[]>([]);
  const [files, setFiles] = useState<KnowledgeFile[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [newUrl, setNewUrl] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [typing, setTyping] = useState(false);
  const [training, setTraining] = useState(false);
  const [published, setPublished] = useState<PublishedAgent | null>(null);
  const [filterMunicipio, setFilterMunicipio] = useState('');
  const [filterModalidade, setFilterModalidade] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const activeGroup = groups.find((g) => g.id === activeGroupId) || null;

  const reload = useCallback(async () => {
    setError(null);
    try {
      const g = await knowledgeService.listGroups();
      setGroups(g);
      if (!activeGroupId && g[0]) setActiveGroupId(g[0].id);
      if (isSupabaseConfigured) {
        try {
          setFiles(await knowledgeService.listFiles());
        } catch {
          setFiles([]);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [activeGroupId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!activeGroupId) {
      setPublished(null);
      return;
    }
    const ag = knowledgeService.getPublishedAgent(activeGroupId);
    setPublished(ag);
    // Validação GP sem planos: só UI. Job externo: knowledge-validate / re-treino manual.
    // (auto-fix Cocó removido — ver Docs/CHUNKING_EROS.md + ops RAG phase2)
    if (ag && agentMissingPlans(ag) && canManage) {
      setToast(
        'Validação: índice GP sem plano/preço — rode Treinar & Publicar com seed Fortaleza (não Cocó sintético).',
      );
    }
  }, [activeGroupId, canManage]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat, typing]);

  const ensureGroup = async () => {
    if (activeGroupId) return activeGroupId;
    const g = await knowledgeService.createGroup('Gurupass Fortaleza');
    await reload();
    setActiveGroupId(g.id);
    return g.id;
  };

  const runTrain = async (payload?: unknown, sourceRef?: string) => {
    if (!canManage) return;
    setTraining(true);
    setError(null);
    setToast(null);
    try {
      const groupId = await ensureGroup();
      // Drop stale Cocó index before writing Fortaleza
      if (!payload) clearLocalAgent(groupId);
      const agent = await knowledgeService.trainAndPublish({
        groupId,
        name: 'GymSite Knowledge',
        payload,
        sourceRef,
      });
      setPublished(agent);
      setToast(
        `Publicado: ${agent.chunk_count} chunks · embed: ${agent.embedding_model || 'local-only'} · domínios: ${(agent.domains || []).join(', ') || '?'} · fontes: ${agent.source_refs.join(', ')}${
          agent.last_error ? ` · aviso: ${agent.last_error}` : ''
        }`,
      );
      setChat([
        {
          id: `sys-${Date.now()}`,
          role: 'assistant',
          text: `Agente publicado (${agent.chunk_count} chunks).\nDomínios: ${(agent.domains || []).join(', ')}\nFontes: ${agent.source_refs.join(', ')}\nTeste GP: "Liste academias Gurupass com Ilimitado 35"\nTeste TP: "Quais academias TotalPass no Cocó com TP3?"`,
        },
      ]);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTraining(false);
    }
  };

  return (
    <div className="h-full flex flex-col lg:flex-row gap-4 p-6 bg-slate-950 text-slate-100 overflow-hidden relative">
      {!canManage && (
        <div className="absolute top-0 left-0 right-0 bg-yellow-500/10 border-b border-yellow-500/20 text-yellow-500 text-xs py-2 px-4 flex items-center gap-2 z-20">
          <AlertCircle className="w-4 h-4" />
          Sem manage_knowledge — troque papel para Criador/Admin para treinar.
        </div>
      )}

      <div className="flex-1 flex flex-col bg-slate-900/40 border border-slate-800 rounded-2xl p-5 gap-4 min-w-0 overflow-hidden">
        <div className="flex items-center gap-3">
          <Database className="w-5 h-5 text-cyan-400" />
          <div>
            <h1 className="text-lg font-bold text-white">Base de Conhecimento</h1>
            <p className="text-xs text-slate-400">
              Train global (GP/TP/regulatório/genérico) → teste no painel
              {!isSupabaseConfigured && ' · modo local'}
            </p>
          </div>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}
        {toast && <p className="text-xs text-cyan-300 whitespace-pre-wrap">{toast}</p>}

        <div className="flex flex-wrap gap-2 items-center">
          {groups.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setActiveGroupId(g.id)}
              className={`text-xs px-3 py-1.5 rounded-xl border ${
                g.id === activeGroupId
                  ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                  : 'border-slate-700 text-slate-400'
              }`}
            >
              {g.name} {g.local ? '(local)' : `(${g.urls.length})`}
            </button>
          ))}
          {canManage && (
            <form
              className="flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newGroupName.trim()) return;
                const g = await knowledgeService.createGroup(newGroupName.trim());
                setNewGroupName('');
                setActiveGroupId(g.id);
                await reload();
              }}
            >
              <input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="Novo grupo"
                className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs"
              />
              <Button type="submit" size="sm">
                <Plus className="w-3 h-3" />
              </Button>
            </form>
          )}
        </div>

        {canManage && activeGroup && isSupabaseConfigured && !activeGroup.local && (
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await knowledgeService.addUrl(activeGroup.id, newUrl.trim());
                setNewUrl('');
                await reload();
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            }}
          >
            <input
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://... (opcional)"
              className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm"
            />
            <Button type="submit">Ingerir URL</Button>
          </form>
        )}

        <div className="flex-1 overflow-y-auto space-y-2">
          {!activeGroup ? (
            <div className="border border-dashed border-slate-800 rounded-xl p-8 text-center text-xs text-slate-500">
              <Globe className="w-8 h-8 mx-auto mb-2 text-slate-700" />
              Crie um grupo ou clique Treinar — cria “Gurupass Fortaleza” automaticamente.
            </div>
          ) : activeGroup.urls.length === 0 ? (
            <div className="border border-dashed border-slate-800 rounded-xl p-6 text-xs text-slate-500 space-y-2">
              <p>Fontes do agente = fixture GP em <code className="text-cyan-400">/knowledge/gp-accept-fortaleza.json</code></p>
              <p>Ou faça upload de JSON (export buscar-academias / artefato ingest).</p>
            </div>
          ) : (
            activeGroup.urls.map((u) => (
              <div
                key={u.id}
                className="flex items-center justify-between p-3 rounded-xl bg-slate-950/40 border border-slate-800"
              >
                <span className="text-xs font-mono text-slate-300 truncate">{u.url}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full border border-slate-700 text-slate-400">
                  {u.status}
                </span>
                {canManage && (
                  <button
                    type="button"
                    onClick={async () => {
                      await knowledgeService.removeUrl(u.id);
                      await reload();
                    }}
                    className="text-slate-500 hover:text-red-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        {isSupabaseConfigured && (
          <div className="border-t border-slate-800 pt-3">
            <p className="text-xs text-slate-500 mb-2">Arquivos meta ({files.length})</p>
            <div className="space-y-1 max-h-20 overflow-y-auto">
              {files.map((f) => (
                <div key={f.id} className="flex justify-between text-xs text-slate-400">
                  <span className="truncate">{f.name}</span>
                  <span>{f.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="w-full lg:w-[440px] flex flex-col gap-4 shrink-0">
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white">Treinamento</h2>
            {published?.status === 'published' ? (
              <span className="text-[10px] flex items-center gap-1 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                <CheckCircle2 className="w-3 h-3" /> published · {published.chunk_count} chunks
              </span>
            ) : (
              <span className="text-[10px] text-slate-500 border border-slate-700 px-2 py-0.5 rounded-full">
                draft
              </span>
            )}
          </div>

          <Button
            className="w-full gap-2"
            disabled={!canManage || training}
            onClick={() => void runTrain()}
          >
            {training ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
            Treinar & Publicar Agente
          </Button>

          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1 gap-1 text-xs"
              disabled={!canManage || training}
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="w-3.5 h-3.5" />
              Upload JSON
            </Button>
            <Button
              variant="outline"
              className="gap-1 text-xs shrink-0"
              disabled={!canManage || training}
              onClick={() => {
                clearLocalAgent();
                setPublished(null);
                void runTrain();
              }}
            >
              Reindex seeds
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  const text = await f.text();
                  const payload = JSON.parse(text);
                  await runTrain(payload, f.name);
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                } finally {
                  e.target.value = '';
                }
              }}
            />
          </div>

          <p className="text-[10px] text-slate-500 leading-relaxed">
            Train global: merge seeds em /knowledge/ (GP+TP) ou upload JSON de qualquer domínio
            (agregador, regulatório pages/laws, genérico). Router responde conforme a pergunta.
            {isSupabaseConfigured ? ' Sync Supabase se grupo remoto.' : ''}
          </p>

          {published?.last_trained_at && (
            <p className="text-[10px] text-slate-400">
              Último treino: {new Date(published.last_trained_at).toLocaleString()}
            </p>
          )}
        </div>

        <div className="flex-1 bg-slate-900/40 border border-slate-800 rounded-2xl p-4 flex flex-col min-h-[320px]">
          <h2 className="text-sm font-bold text-white mb-2">Teste do agente</h2>
          <div className="flex gap-2 mb-2">
            <input
              value={filterMunicipio}
              onChange={(e) => setFilterMunicipio(e.target.value)}
              disabled={!canChat}
              placeholder="Município (ex: Arujá)"
              className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-[11px]"
            />
            <select
              value={filterModalidade}
              onChange={(e) => setFilterModalidade(e.target.value)}
              disabled={!canChat}
              className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-slate-300"
            >
              <option value="">Modalidade (auto)</option>
              <option value="musculacao">musculacao</option>
              <option value="pilates">pilates</option>
              <option value="yoga">yoga</option>
              <option value="boxe">boxe</option>
              <option value="jiu_jitsu">jiu_jitsu</option>
              <option value="crossfit">crossfit</option>
            </select>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 mb-3">
            {chat.map((m) => (
              <div key={m.id} className="space-y-1">
                <div
                  className={`text-xs whitespace-pre-wrap rounded-lg px-2 py-1.5 ${
                    m.role === 'user'
                      ? 'text-right text-cyan-200 bg-cyan-500/5 ml-8'
                      : 'text-slate-300 bg-slate-950/50 mr-4'
                  }`}
                >
                  {m.text}
                </div>
                {m.role === 'assistant' && m.sources && m.sources.length > 0 && (
                  <div className="mr-4 flex flex-wrap gap-1.5 pl-1">
                    <span className="text-[10px] uppercase tracking-wider text-slate-500 self-center">
                      Fontes
                    </span>
                    {m.sources.map((s) => {
                      const label = `${s.chunk_id.slice(0, 24)}${s.chunk_id.length > 24 ? '…' : ''} · ${s.score.toFixed(2)}`;
                      if (s.url) {
                        return (
                          <a
                            key={`${m.id}-${s.chunk_id}`}
                            href={s.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[10px] px-2 py-0.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20"
                            title={s.section || s.chunk_id}
                          >
                            {label}
                          </a>
                        );
                      }
                      return (
                        <span
                          key={`${m.id}-${s.chunk_id}`}
                          className="text-[10px] px-2 py-0.5 rounded-full border border-slate-700 bg-slate-900/60 text-slate-300"
                          title={s.section || s.chunk_id}
                        >
                          {label}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
            {typing && (
              <div className="flex items-center gap-1 text-slate-500 text-xs">
                <Loader2 className="w-3 h-3 animate-spin" /> pensando…
              </div>
            )}
            <div ref={endRef} />
          </div>
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!canChat || !chatInput.trim()) return;
              let groupId = activeGroupId;
              if (!groupId) {
                groupId = await ensureGroup();
              }
              if (!knowledgeService.getPublishedAgent(groupId)) {
                setError('Publique o agente antes de testar (Treinar & Publicar).');
                return;
              }
              const text = chatInput.trim();
              setChatInput('');
              setChat((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', text }]);
              setTyping(true);
              try {
                const history = [...chat, { id: 'x', role: 'user' as const, text }].map((m) => ({
                  role: m.role === 'user' ? 'user' : 'assistant',
                  content: m.text,
                }));
                const res = await knowledgeService.ask({
                  groupId,
                  messages: history,
                  municipio: filterMunicipio.trim() || undefined,
                  modalidade: filterModalidade.trim() || undefined,
                });
                setChat((prev) => [
                  ...prev,
                  {
                    id: `a-${Date.now()}`,
                    role: 'assistant',
                    text: `${res.text}${res.provider ? `\n\n〔${res.provider}〕` : ''}`,
                    sources: res.sources,
                  },
                ]);
              } catch (err) {
                setChat((prev) => [
                  ...prev,
                  {
                    id: `e-${Date.now()}`,
                    role: 'assistant',
                    text: `Erro: ${err instanceof Error ? err.message : String(err)}`,
                  },
                ]);
              } finally {
                setTyping(false);
              }
            }}
          >
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              disabled={!canChat}
              placeholder='Ex: TotalPass TP3 Cocó / Gurupass Ilimitado 35'
              className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs"
            />
            <Button type="submit" size="sm" disabled={!canChat}>
              <Send className="w-3.5 h-3.5" />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default KnowledgeBase;
