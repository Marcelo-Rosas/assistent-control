import React, { useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw, Send, Sparkles } from 'lucide-react';
import { useRoles } from '../../context/RoleContext';
import { useFuguPlayground } from '../../hooks/useFuguPlayground';
import { Button } from '../Button';
import type { ReasoningEffort } from '../../services/fuguPlaygroundService';

export const FuguPlayground: React.FC = () => {
  const { currentRole } = useRoles();
  const {
    messages,
    isLoading,
    error,
    model,
    reasoningEffort,
    enableWebSearch,
    send,
    setModel,
    setReasoningEffort,
    toggleWebSearch,
    clear,
  } = useFuguPlayground();
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  if (currentRole !== 'admin') {
    return (
      <div className="h-full flex items-center justify-center p-8 text-slate-400 text-sm">
        Playground Fugu restrito a administradores.
      </div>
    );
  }

  const effortOptions: ReasoningEffort[] =
    model === 'fugu-ultra' ? ['high', 'xhigh', 'max'] : ['high', 'xhigh'];

  return (
    <div className="h-full flex flex-col bg-slate-950 text-slate-100 p-6 gap-4">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-2 mr-auto">
          <Sparkles className="w-5 h-5 text-cyan-400" />
          <div>
            <h1 className="text-lg font-bold text-white">Fugu Playground</h1>
            <p className="text-xs text-slate-500">Sakana via Edge — sem chave no browser</p>
          </div>
        </div>

        <select
          value={model}
          onChange={(e) => setModel(e.target.value as any)}
          className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs"
        >
          <option value="fugu">fugu</option>
          <option value="fugu-ultra">fugu-ultra</option>
          <option value="fugu-cyber">fugu-cyber</option>
        </select>

        <select
          value={reasoningEffort}
          onChange={(e) => setReasoningEffort(e.target.value as ReasoningEffort)}
          className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs"
        >
          {effortOptions.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={toggleWebSearch}
          className={`text-xs px-3 py-1.5 rounded-lg border ${
            enableWebSearch
              ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-300'
              : 'border-slate-700 text-slate-400'
          }`}
        >
          Busca Web {enableWebSearch ? 'ON' : 'OFF'}
        </button>

        <button type="button" onClick={clear} className="p-2 text-slate-500 hover:text-slate-200" title="Limpar">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {messages.length === 0 && (
          <p className="text-sm text-slate-500 text-center mt-12">Envie uma mensagem para testar o Fugu.</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                m.role === 'user'
                  ? 'bg-gradient-to-r from-cyan-600 to-teal-600 text-white rounded-tr-sm'
                  : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-sm'
              }`}
            >
              {m.content}
              {m.usage && (
                <div className="mt-2 pt-2 border-t border-slate-700/50 text-[10px] text-slate-500">
                  in {m.usage.input_tokens ?? '—'} · out {m.usage.output_tokens ?? '—'}
                  {m.usage.orchestration_input_tokens != null &&
                    ` · orch in ${m.usage.orchestration_input_tokens}`}
                  {m.usage.orchestration_output_tokens != null &&
                    ` · orch out ${m.usage.orchestration_output_tokens}`}
                </div>
              )}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex items-center gap-2 text-xs text-cyan-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            Fugu está orquestrando e pensando…
          </div>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div ref={endRef} />
      </div>

      <form
        className="flex gap-2 border-t border-slate-800 pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          const t = input;
          setInput('');
          void send(t);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Pergunte ao Fugu…"
          className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500"
        />
        <Button type="submit" disabled={isLoading || !input.trim()} className="px-4">
          <Send className="w-4 h-4" />
        </Button>
      </form>
    </div>
  );
};

export default FuguPlayground;
