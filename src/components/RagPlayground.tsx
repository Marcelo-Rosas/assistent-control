import React, { useEffect, useRef, useState } from 'react';
import { Bug, Database, Loader2, Save, Send } from 'lucide-react';
import { useRoles } from '../context/RoleContext';
import { knowledgeService, type KnowledgeGroup } from '../services/knowledgeService';
import { Button } from './Button';

type RagSource = {
  chunk_id: string;
  score: number;
  nome_academia?: string | null;
  modalidade?: string | null;
  plano_minimo?: string | null;
  warning?: string | null;
  municipios?: string[];
};

type ChatMsg = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  sources?: RagSource[];
  latency_ms?: number;
  provider?: string;
  retrieval?: string;
  debug?: { prompt: string; chunks_used: number };
};

export const RagPlayground: React.FC = () => {
  const { currentRole } = useRoles();
  const [groups, setGroups] = useState<KnowledgeGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');

  const [topK, setTopK] = useState(15);
  const [minScore, setMinScore] = useState(0.6);
  const [municipio, setMunicipio] = useState('');
  const [modalidade, setModalidade] = useState('');
  const [showDebug, setShowDebug] = useState(true);

  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (currentRole !== 'admin') return;
    void (async () => {
      try {
        const g = await knowledgeService.listGroups();
        setGroups(g);
        if (g.length && !selectedGroupId) {
          const preferred =
            g.find((x) => /totalpass/i.test(x.name))?.id || g[0].id;
          setSelectedGroupId(preferred);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [currentRole, selectedGroupId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  if (currentRole !== 'admin') {
    return (
      <div className="h-full flex items-center justify-center p-8 text-slate-400 text-sm">
        Playground RAG restrito a administradores.
      </div>
    );
  }

  const handleSend = async () => {
    if (!input.trim() || !selectedGroupId || isLoading) return;

    const userMsg: ChatMsg = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: input.trim(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);
    setError(null);

    try {
      const startTime = performance.now();
      const history = messages
        .concat(userMsg)
        .map((m) => ({ role: m.role, content: m.text }));

      const res = await knowledgeService.ask({
        groupId: selectedGroupId,
        messages: history,
        topK,
        minSimilarity: minScore,
        municipio: municipio.trim() || undefined,
        modalidade: modalidade.trim() || undefined,
        includeDebug: showDebug,
      });

      const latency = Math.round(performance.now() - startTime);
      const assistantMsg: ChatMsg = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        text: res.text,
        sources: res.sources as RagSource[] | undefined,
        latency_ms: latency,
        provider: res.provider,
        retrieval: res.retrieval,
        debug: {
          prompt: res.debug_prompt || '',
          chunks_used: res.chunk_count || 0,
        },
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const saveToEvaluation = (msg: ChatMsg) => {
    const userPrev = [...messages]
      .reverse()
      .find((m) => m.role === 'user' && messages.indexOf(m) < messages.indexOf(msg));
    const evalEntry = {
      query: userPrev?.text,
      expected_sources: msg.sources?.map((s) => s.chunk_id),
      actual_response: msg.text,
      scores: msg.sources?.map((s) => ({ id: s.chunk_id, score: s.score })),
      top_k: topK,
      min_similarity: minScore,
      group_id: selectedGroupId,
      timestamp: new Date().toISOString(),
    };
    console.log('eval_dataset_entry', evalEntry);
    try {
      const key = 'rag_eval_dataset';
      const prev = JSON.parse(localStorage.getItem(key) || '[]') as unknown[];
      prev.push(evalEntry);
      localStorage.setItem(key, JSON.stringify(prev));
      alert(`Avaliação salva (localStorage.${key}, n=${prev.length}).`);
    } catch {
      alert('Entrada logada no console (localStorage falhou).');
    }
  };

  return (
    <div className="h-full flex flex-col bg-slate-950 text-slate-100 p-6 gap-4 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-800 pb-4 shrink-0">
        <div className="flex items-center gap-2 mr-auto min-w-0">
          <Database className="w-5 h-5 text-cyan-400 shrink-0" />
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-white">RAG Playground</h1>
            <p className="text-xs text-slate-500 truncate">
              match_chunks · fontes · scores · debug prompt
            </p>
          </div>
        </div>

        <select
          value={selectedGroupId}
          onChange={(e) => {
            setSelectedGroupId(e.target.value);
            setMessages([]);
          }}
          className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs max-w-[220px]"
        >
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
              {g.local ? ' (local)' : ''}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-1.5 text-xs text-slate-400">
          Top-K
          <input
            type="number"
            min={1}
            max={50}
            value={topK}
            onChange={(e) => setTopK(Number(e.target.value) || 15)}
            className="w-14 bg-slate-900 border border-slate-700 rounded px-2 py-1"
          />
        </label>

        <label className="flex items-center gap-1.5 text-xs text-slate-400">
          Min
          <input
            type="number"
            step="0.05"
            min={0}
            max={1}
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value) || 0)}
            className="w-16 bg-slate-900 border border-slate-700 rounded px-2 py-1"
          />
        </label>

        <input
          value={municipio}
          onChange={(e) => setMunicipio(e.target.value)}
          placeholder="Município (opcional)"
          className="w-36 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs placeholder:text-slate-600"
        />

        <input
          value={modalidade}
          onChange={(e) => setModalidade(e.target.value)}
          placeholder="Modalidade (opcional)"
          className="w-36 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs placeholder:text-slate-600"
        />

        <button
          type="button"
          onClick={() => setShowDebug((v) => !v)}
          className={`text-xs px-3 py-1.5 rounded-lg border flex items-center gap-1 ${
            showDebug
              ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-300'
              : 'border-slate-700 text-slate-400'
          }`}
        >
          <Bug className="w-3 h-3" /> Debug {showDebug ? 'ON' : 'OFF'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 pr-1 min-h-0">
        {messages.length === 0 && (
          <p className="text-sm text-slate-500 text-center mt-12 px-4">
            Ex.: “Onde tem pilates com TP 3 em Campinas?” · “Academia com agendamento prévio em
            São Paulo”
          </p>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap ${
                m.role === 'user'
                  ? 'bg-gradient-to-r from-cyan-600 to-teal-600 text-white rounded-tr-sm'
                  : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-sm'
              }`}
            >
              {m.text}

              {m.role === 'assistant' && (
                <div className="mt-3 pt-3 border-t border-slate-700/50 space-y-2">
                  <div className="flex flex-wrap gap-2 text-[10px] text-slate-500">
                    <span>{m.latency_ms}ms</span>
                    <span>{m.provider || 'llm'}</span>
                    <span>{m.retrieval || 'vector'}</span>
                    <span>{m.debug?.chunks_used || 0} chunks</span>
                  </div>

                  {m.sources && m.sources.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                        Fontes
                      </p>
                      {m.sources.map((src, idx) => (
                        <div
                          key={`${src.chunk_id}-${idx}`}
                          className="text-[10px] bg-slate-950/50 p-2 rounded border border-slate-800 flex flex-col gap-1"
                        >
                          <div className="flex justify-between items-start gap-2">
                            <div className="truncate font-medium text-cyan-400">
                              {src.nome_academia || 'Academia'}
                              {src.modalidade ? (
                                <span className="text-slate-400 font-normal">
                                  {' '}
                                  ({src.modalidade})
                                </span>
                              ) : null}
                            </div>
                            <span
                              className={`shrink-0 px-1.5 py-0.5 rounded ${
                                src.score >= 0.8
                                  ? 'bg-emerald-500/20 text-emerald-400'
                                  : 'bg-yellow-500/20 text-yellow-400'
                              }`}
                            >
                              {(src.score * 100).toFixed(0)}%
                            </span>
                          </div>
                          {src.plano_minimo && (
                            <div className="text-slate-400">Plano: {src.plano_minimo}</div>
                          )}
                          {src.municipios && src.municipios.length > 0 && (
                            <div className="text-slate-500">
                              {src.municipios.join(', ')}
                            </div>
                          )}
                          {src.warning && (
                            <div className="text-yellow-300/80 italic">⚠ {src.warning}</div>
                          )}
                          <div className="text-slate-600 font-mono text-[9px] break-all">
                            {src.chunk_id}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => saveToEvaluation(m)}
                    className="text-[10px] text-slate-400 hover:text-cyan-400 flex items-center gap-1 mt-1"
                  >
                    <Save className="w-3 h-3" /> Salvar avaliação
                  </button>
                </div>
              )}

              {m.role === 'assistant' && showDebug && m.debug?.prompt && (
                <details className="mt-2 text-[10px] text-slate-500">
                  <summary className="cursor-pointer hover:text-slate-300">
                    Prompt enviado ao LLM
                  </summary>
                  <pre className="mt-2 p-2 bg-slate-950 rounded border border-slate-800 overflow-x-auto whitespace-pre-wrap max-h-60">
                    {m.debug.prompt}
                  </pre>
                </details>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex items-center gap-2 text-xs text-cyan-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            Embed query → match_chunks → LLM…
          </div>
        )}
        {error && (
          <p className="text-xs text-red-400 bg-red-500/10 p-2 rounded border border-red-500/20">
            {error}
          </p>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="flex gap-2 border-t border-slate-800 pt-4 shrink-0"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSend();
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ex: Onde tem pilates com TP3 em Campinas?"
          className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500 placeholder:text-slate-600"
        />
        <Button
          type="submit"
          disabled={isLoading || !input.trim() || !selectedGroupId}
          className="px-4"
        >
          <Send className="w-4 h-4" />
        </Button>
      </form>
    </div>
  );
};

export default RagPlayground;
