import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Database, Globe, Plus, Trash2, Send, Loader2, AlertCircle } from 'lucide-react';
import { useRoles } from '../../context/RoleContext';
import { Button } from '../Button';
import { knowledgeService, KnowledgeFile, KnowledgeGroup } from '../../services/knowledgeService';
import { isSupabaseConfigured } from '../../services/supabaseClient';

type ChatMsg = { id: string; role: 'user' | 'assistant'; text: string };

export const KnowledgeBase: React.FC = () => {
  const { hasPermission } = useRoles();
  const canManage = hasPermission('manage_settings');
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
  const endRef = useRef<HTMLDivElement>(null);

  const activeGroup = groups.find((g) => g.id === activeGroupId) || null;

  const reload = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setError(null);
    try {
      const [g, f] = await Promise.all([knowledgeService.listGroups(), knowledgeService.listFiles()]);
      setGroups(g);
      setFiles(f);
      if (!activeGroupId && g[0]) setActiveGroupId(g[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [activeGroupId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat, typing]);

  if (!isSupabaseConfigured) {
    return (
      <div className="p-6 text-sm text-amber-300 bg-amber-500/10 border-b border-amber-500/20">
        Configure `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` para usar a Base de Conhecimento.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col lg:flex-row gap-4 p-6 bg-slate-950 text-slate-100 overflow-hidden">
      {!canManage && (
        <div className="absolute top-0 left-0 right-0 bg-yellow-500/10 border-b border-yellow-500/20 text-yellow-500 text-xs py-2 px-4 flex items-center gap-2 z-20">
          <AlertCircle className="w-4 h-4" />
          Visualização apenas — use Administrador para gerenciar fontes.
        </div>
      )}

      <div className="flex-1 flex flex-col bg-slate-900/40 border border-slate-800 rounded-2xl p-5 gap-4 min-w-0 overflow-hidden">
        <div className="flex items-center gap-3">
          <Database className="w-5 h-5 text-cyan-400" />
          <div>
            <h1 className="text-lg font-bold text-white">Base de Conhecimento</h1>
            <p className="text-xs text-slate-400">GymSite — fontes persistidas (status honesto: pending até indexação real)</p>
          </div>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}
        {toast && <p className="text-xs text-cyan-300">{toast}</p>}

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
              {g.name} ({g.urls.length})
            </button>
          ))}
          {canManage && (
            <form
              className="flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newGroupName.trim()) return;
                await knowledgeService.createGroup(newGroupName.trim());
                setNewGroupName('');
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

        {canManage && activeGroup && (
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
              placeholder="https://..."
              className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm"
            />
            <Button type="submit">Ingerir URL</Button>
          </form>
        )}

        <div className="flex-1 overflow-y-auto space-y-2">
          {!activeGroup || activeGroup.urls.length === 0 ? (
            <div className="border border-dashed border-slate-800 rounded-xl p-8 text-center text-xs text-slate-500">
              <Globe className="w-8 h-8 mx-auto mb-2 text-slate-700" />
              Nenhum grupo/URL. {canManage ? 'Crie um grupo e adicione links.' : ''}
            </div>
          ) : (
            activeGroup.urls.map((u) => (
              <div key={u.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-950/40 border border-slate-800">
                <span className="text-xs font-mono text-slate-300 truncate">{u.url}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] px-2 py-0.5 rounded-full border border-slate-700 text-slate-400">{u.status}</span>
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
              </div>
            ))
          )}
        </div>

        <div className="border-t border-slate-800 pt-3">
          <p className="text-xs text-slate-500 mb-2">Arquivos ({files.length}) — metadados only; status pending</p>
          {canManage && (
            <label className="text-xs text-cyan-400 cursor-pointer">
              + Adicionar arquivo (meta)
              <input
                type="file"
                className="hidden"
                multiple
                onChange={async (e) => {
                  const list = Array.from(e.target.files || []);
                  for (const f of list) {
                    await knowledgeService.addFileMeta({ name: f.name, size_bytes: f.size, mime: f.type });
                  }
                  await reload();
                }}
              />
            </label>
          )}
          <div className="mt-2 space-y-1 max-h-28 overflow-y-auto">
            {files.map((f) => (
              <div key={f.id} className="flex justify-between text-xs text-slate-400">
                <span className="truncate">{f.name}</span>
                <span>{f.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="w-full lg:w-[420px] flex flex-col gap-4 shrink-0">
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4">
          <h2 className="text-sm font-bold text-white mb-2">Treinamento</h2>
          <Button
            className="w-full"
            disabled={!canManage}
            onClick={() => setToast('Indexação automática v1 ainda não disponível')}
          >
            Treinar & Publicar Agente
          </Button>
          <p className="text-[10px] text-slate-500 mt-2">Sem progresso falso — worker de embeddings fica para ciclo futuro.</p>
        </div>

        <div className="flex-1 bg-slate-900/40 border border-slate-800 rounded-2xl p-4 flex flex-col min-h-[280px]">
          <h2 className="text-sm font-bold text-white mb-2">Teste (Edge)</h2>
          <div className="flex-1 overflow-y-auto space-y-2 mb-3">
            {chat.map((m) => (
              <div key={m.id} className={`text-xs whitespace-pre-wrap ${m.role === 'user' ? 'text-right text-cyan-200' : 'text-slate-300'}`}>
                {m.text}
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
              if (!canChat || !activeGroupId || !chatInput.trim()) return;
              const text = chatInput.trim();
              setChatInput('');
              setChat((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', text }]);
              setTyping(true);
              try {
                const history = [...chat, { id: 'x', role: 'user' as const, text }].map((m) => ({
                  role: m.role === 'user' ? 'user' : 'assistant',
                  content: m.text,
                }));
                const res = await knowledgeService.ask({ groupId: activeGroupId, messages: history });
                setChat((prev) => [...prev, { id: `a-${Date.now()}`, role: 'assistant', text: res.text }]);
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
              disabled={!canChat || !activeGroupId}
              placeholder="Pergunte com base nas URLs…"
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
