import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as tf from '@tensorflow/tfjs';
import * as tfvis from '@tensorflow/tfjs-vis';
import { ArrowDown, ArrowUp, Brain, Loader2, PanelRightOpen, Play, RefreshCw, X } from 'lucide-react';
import {
  buildCityTensorsStratified,
  modalityHistogram,
  scatterPopVsPlan,
} from '../../lib/academiaTrainFeatures';
import { createAggregatorModel, trainAggregatorModel, type TrainProgress } from '../../lib/aggregatorModel';
import {
  analyzeEpochHistory,
  epochAnalysisTableData,
} from '../../lib/trainEpochAnalysis';
import type { AcademiaTrainFile, RecomendacaoCidade } from '../../types/academiaTrain';
import {
  normalizePattern,
  PATTERN_FILTER_OPTIONS,
  PATTERN_LABELS,
} from '../../types/academiaTrain';

import {
  CORPORATIVO_FILTER_OPTIONS,
  matchesCorporativoFilter,
  matchesPopBand,
  matchesRendaFilter,
  type PopBand,
  RENDA_FILTER_OPTIONS,
  type CorporativoFilter,
  type RendaFilter,
} from '../../types/municipioContext';

const DATA_URL = '/data/academia.train.json';

type SortKey =
  | 'prioridade'
  | 'uf'
  | 'cidade'
  | 'pop'
  | 'renda'
  | 'empresas'
  | 'assalariados'
  | 'corp'
  | 'pattern'
  | 'score';

type SortDir = 'asc' | 'desc';

const PRIORIDADE_RANK: Record<string, number> = { alta: 3, media: 2, baixa: 1 };

function compareRecomendacoes(a: RecomendacaoCidade, b: RecomendacaoCidade, key: SortKey): number {
  switch (key) {
    case 'prioridade':
      return (PRIORIDADE_RANK[a.prioridade] ?? 0) - (PRIORIDADE_RANK[b.prioridade] ?? 0);
    case 'uf':
      return a.uf.localeCompare(b.uf, 'pt-BR');
    case 'cidade':
      return a.cidade.localeCompare(b.cidade, 'pt-BR');
    case 'pop':
      return a.pop - b.pop;
    case 'renda':
      return (a.mercado?.renda_pc_mediana ?? -1) - (b.mercado?.renda_pc_mediana ?? -1);
    case 'empresas':
      return (a.mercado?.empresas_atuantes ?? -1) - (b.mercado?.empresas_atuantes ?? -1);
    case 'assalariados':
      return (a.mercado?.pessoal_assalariado ?? -1) - (b.mercado?.pessoal_assalariado ?? -1);
    case 'corp':
      return (a.mercado?.score_corporativo ?? -1) - (b.mercado?.score_corporativo ?? -1);
    case 'pattern':
      return normalizePattern(a.pattern).localeCompare(normalizePattern(b.pattern), 'pt-BR');
    case 'score':
      return a.score - b.score;
    default:
      return 0;
  }
}

export function AggregatorTrainLab() {
  const [data, setData] = useState<AcademiaTrainFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [training, setTraining] = useState(false);
  const [epochs, setEpochs] = useState(60);
  const [lastProgress, setLastProgress] = useState<TrainProgress | null>(null);
  const [epochSuggestion, setEpochSuggestion] = useState<string | null>(null);
  const [model, setModel] = useState<tf.Sequential | null>(null);

  const [filterUf, setFilterUf] = useState('');
  const [filterCidade, setFilterCidade] = useState('');
  const [filterPop, setFilterPop] = useState<PopBand[]>([]);
  const [filterPattern, setFilterPattern] = useState<string[]>([]);
  const [filterRenda, setFilterRenda] = useState<RendaFilter[]>([]);
  const [filterCorporativo, setFilterCorporativo] = useState<CorporativoFilter[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(DATA_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status} — rode npm run train:academia:build`);
      const json = (await res.json()) as AcademiaTrainFile;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const ufOptions = useMemo(() => {
    if (!data) return [];
    const ufs = new Set(data.recomendacoes.map((r) => r.uf));
    return [...ufs].sort();
  }, [data]);

  const cidadeOptions = useMemo(() => {
    if (!data) return [];
    const rows = filterUf
      ? data.recomendacoes.filter((r) => r.uf === filterUf)
      : data.recomendacoes;
    return [...new Set(rows.map((r) => r.cidade))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [data, filterUf]);

  const filteredRecomendacoes = useMemo(() => {
    if (!data) return [];
    const q = filterCidade.trim().toLowerCase();
    const rows = data.recomendacoes
      .filter((r) => !filterUf || r.uf === filterUf)
      .filter((r) => !q || r.cidade.toLowerCase().includes(q))
      .filter((r) => matchesPopBand(r.pop, filterPop))
      .filter((r) => matchesRendaFilter(r.mercado?.renda_pc_mediana, filterRenda))
      .filter((r) => matchesCorporativoFilter(r.mercado?.empresas_por_mil, filterCorporativo))
      .filter((r) => {
        if (filterPattern.length === 0) return true;
        const p = normalizePattern(r.pattern);
        return filterPattern.includes(p);
      });

    const sign = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => sign * compareRecomendacoes(a, b, sortKey));
  }, [
    data,
    filterUf,
    filterCidade,
    filterPop,
    filterPattern,
    filterRenda,
    filterCorporativo,
    sortKey,
    sortDir,
  ]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(
        key === 'cidade' || key === 'uf' || key === 'pattern' || key === 'prioridade' ? 'asc' : 'desc',
      );
    }
  };

  const clearFilters = () => {
    setFilterUf('');
    setFilterCidade('');
    setFilterPop([]);
    setFilterPattern([]);
    setFilterRenda([]);
    setFilterCorporativo([]);
  };

  const togglePop = (key: PopBand) => {
    setFilterPop((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key],
    );
  };

  const togglePattern = (key: string) => {
    setFilterPattern((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key],
    );
  };

  const toggleRenda = (key: RendaFilter) => {
    setFilterRenda((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key],
    );
  };

  const toggleCorporativo = (key: CorporativoFilter) => {
    setFilterCorporativo((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key],
    );
  };

  const hasActiveFilters =
    filterUf ||
    filterCidade.trim() ||
    filterPop.length > 0 ||
    filterPattern.length > 0 ||
    filterRenda.length > 0 ||
    filterCorporativo.length > 0;

  const renderExploration = useCallback(async (file: AcademiaTrainFile) => {
    const scatter = scatterPopVsPlan(file.cidades);
    await tfvis.render.scatterplot(
      { name: 'Pop (norm) × plan_rank médio', tab: 'Explorar' },
      {
        values: scatter.map((p) => [p.x, p.y]),
        series: scatter.map((p) => p.pattern),
      },
      { xLabel: 'log pop (0-1)', yLabel: 'plan rank médio (0-1)', height: 320 },
    );

    const hist = modalityHistogram(file.cidades);
    await tfvis.render.barchart(
      { name: 'Modalidades SP (WH+TP)', tab: 'Explorar' },
      hist,
      { xLabel: 'modalidade', yLabel: 'count', height: 320 },
    );

    const desert = file.cidades.filter((c) => c.pattern === 'DESERTO');
    await tfvis.render.scatterplot(
      { name: 'DESERTO — pop × score', tab: 'Explorar' },
      {
        values: desert.map((c) => [
          Math.min(1, Math.log1p(c.pop) / Math.log1p(1_200_000)),
          Math.min(1, Math.log1p(c.score) / Math.log1p(2_000_000)),
        ]),
      },
      { xLabel: 'pop norm', yLabel: 'score norm', height: 280 },
    );
  }, []);

  useEffect(() => {
    if (!data) return;
    void renderExploration(data);
  }, [data, renderExploration]);

  const runTrain = async () => {
    if (!data?.cidades.length) return;
    setTraining(true);
    setLastProgress(null);
    setEpochSuggestion(null);
    try {
      const m = createAggregatorModel(16, 8);
      setModel(m);
      await tfvis.show.modelSummary({ name: 'Aggregator MLP (SP)', tab: 'Modelo' }, m);

      const { xs, ys, n, xsVal, ysVal, nVal } = buildCityTensorsStratified(data.cidades, 0.2);
      const container = { name: 'Loss / Accuracy', tab: 'Treino' };

      const { history } = await trainAggregatorModel(m, xs, ys, n, {
        epochs,
        batchSize: 32,
        xsVal,
        ysVal,
        nVal,
        onEpoch: setLastProgress,
        fitCallbacks: tfvis.show.fitCallbacks(container, ['loss', 'acc', 'val_loss', 'val_acc']),
      });

      const analysis = analyzeEpochHistory(history, epochs);
      setEpochSuggestion(
        analysis.suggestedEpochs != null
          ? `Sugestão: ${analysis.suggestedEpochs} epochs — ${analysis.suggestion}`
          : analysis.suggestion,
      );

      const table = epochAnalysisTableData(analysis);
      await tfvis.render.table(
        { name: 'Comparativo epochs / early stop', tab: 'Early stop' },
        table,
        { fontSize: 11 },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTraining(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400 gap-2">
        <Loader2 className="w-5 h-5 animate-spin" />
        Carregando academia.train.json…
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="p-8 max-w-xl">
        <p className="text-red-400 mb-4">{error}</p>
        <button
          type="button"
          onClick={() => void loadData()}
          className="px-4 py-2 rounded-lg bg-slate-800 text-sm hover:bg-slate-700"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Brain className="w-6 h-6 text-cyan-400" />
            Lab ML Agregadores — SP (WH + TP)
          </h1>
          <p className="text-sm text-slate-400 mt-1 max-w-2xl">
            TensorFlow.js + tfjs-vis. Classifica padrão de cobertura por município SP (
            {PATTERN_LABELS.join(', ')}). Dataset:{' '}
            <code className="text-cyan-300/90">academia.train.json</code>
            {data.context_sources && (
              <>
                {' '}
                + <code className="text-cyan-300/90">municipio-context.json</code>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => tfvis.visor().open()}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-700 bg-slate-900 text-sm hover:bg-slate-800"
          >
            <PanelRightOpen className="w-4 h-4" />
            Abrir Visor
          </button>
          <button
            type="button"
            onClick={() => void loadData()}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-700 bg-slate-900 text-sm hover:bg-slate-800"
          >
            <RefreshCw className="w-4 h-4" />
            Recarregar JSON
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <Stat label="WH academias" value={data.stats.n_academias_wh} />
        <Stat label="TP academias" value={data.stats.n_academias_tp} />
        <Stat label="Municípios SP" value={data.stats.n_cidades} />
        <Stat label="DESERTO" value={data.stats.n_deserto} />
      </div>

      <div className="flex flex-wrap items-end gap-4 p-4 rounded-xl border border-slate-800 bg-slate-900/50">
        <label className="text-sm text-slate-400">
          Epochs
          <input
            type="number"
            min={10}
            max={200}
            value={epochs}
            onChange={(e) => setEpochs(Number(e.target.value) || 60)}
            className="mt-1 block w-24 px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100"
          />
        </label>
        <button
          type="button"
          disabled={training}
          onClick={() => void runTrain()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-sm font-medium"
        >
          {training ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          Treinar rede
        </button>
        {lastProgress && (
          <span className="text-xs text-slate-400 font-mono">
            epoch {lastProgress.epoch + 1} loss={lastProgress.loss.toFixed(3)} acc=
            {(lastProgress.acc * 100).toFixed(1)}%
            {lastProgress.valAcc != null && ` val=${(lastProgress.valAcc * 100).toFixed(1)}%`}
          </span>
        )}
        {epochSuggestion && !training && (
          <span className="text-xs text-amber-300/90 max-w-md">{epochSuggestion}</span>
        )}
        {model && !training && (
          <span className="text-xs text-emerald-400">Modelo em memória — veja abas no Visor</span>
        )}
      </div>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="text-sm font-semibold text-slate-300">
            Recomendações — cidades sem cobertura completa ({filteredRecomendacoes.length})
          </h2>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200"
            >
              <X className="w-3 h-3" />
              Limpar filtros
            </button>
          )}
        </div>
        <p className="text-xs text-slate-500 mb-3">
          <strong className="text-slate-400">Plano / Modalidades</strong> = moda no agregador já presente no
          município (academias com o plano mais frequente).{' '}
          <strong className="text-slate-400">Sugestão</strong> = agregador faltante, espelhado em cidade com WH+TP
          e população similar.
        </p>

        <div className="flex flex-wrap gap-4 p-4 mb-4 rounded-xl border border-slate-800 bg-slate-900/40 text-sm">
          <label className="text-slate-400 min-w-[120px]">
            Estado
            <select
              value={filterUf}
              onChange={(e) => setFilterUf(e.target.value)}
              className="mt-1 block w-full min-w-[100px] px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100"
            >
              <option value="">Todos</option>
              {ufOptions.map((uf) => (
                <option key={uf} value={uf}>{uf}</option>
              ))}
            </select>
          </label>

          <label className="text-slate-400 min-w-[180px] flex-1">
            Cidade
            <input
              type="search"
              list="cidade-filter-list"
              value={filterCidade}
              onChange={(e) => setFilterCidade(e.target.value)}
              placeholder="Buscar…"
              className="mt-1 block w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100"
            />
            <datalist id="cidade-filter-list">
              {cidadeOptions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>

          <div className="text-slate-400">
            <span className="block mb-1">População</span>
            <div className="flex flex-wrap gap-2 mt-1">
              {(['50', '100', '200+'] as PopBand[]).map((key) => (
                <FilterChip
                  key={key}
                  label={key}
                  active={filterPop.includes(key)}
                  onClick={() => togglePop(key)}
                />
              ))}
            </div>
          </div>

          <div className="text-slate-400">
            <span className="block mb-1">Renda pc</span>
            <div className="flex flex-wrap gap-2 mt-1">
              {RENDA_FILTER_OPTIONS.map((key) => (
                <FilterChip
                  key={key}
                  label={key}
                  active={filterRenda.includes(key)}
                  onClick={() => toggleRenda(key)}
                />
              ))}
            </div>
            <span className="text-[10px] text-slate-600 mt-1 block">
              1 &lt;1,5k · 2 &lt;2,5k · 3 ≥2,5k
            </span>
          </div>

          <div className="text-slate-400">
            <span className="block mb-1">Emp / mil hab</span>
            <div className="flex flex-wrap gap-2 mt-1">
              {CORPORATIVO_FILTER_OPTIONS.map((key) => (
                <FilterChip
                  key={key}
                  label={key}
                  active={filterCorporativo.includes(key)}
                  onClick={() => toggleCorporativo(key)}
                />
              ))}
            </div>
            <span className="text-[10px] text-slate-600 mt-1 block">
              1 &lt;40 · 2 &lt;60 · 3 ≥60
            </span>
          </div>

          <div className="text-slate-400">
            <span className="block mb-1">Categoria</span>
            <div className="flex flex-wrap gap-2 mt-1">
              {PATTERN_FILTER_OPTIONS.map((key) => (
                <FilterChip
                  key={key}
                  label={key}
                  active={filterPattern.includes(key)}
                  onClick={() => togglePattern(key)}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-900/80 text-slate-400">
              <tr>
                <SortableTh label="Prioridade" keyId="prioridade" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh label="UF" keyId="uf" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Cidade" keyId="cidade" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Pop" keyId="pop" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Renda pc" keyId="renda" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Empresas" keyId="empresas" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Assalariados" keyId="assalariados" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Corp." keyId="corp" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Padrão" keyId="pattern" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Score" keyId="score" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <th className="p-3">Plano (presente)</th>
                <th className="p-3">Modalidades (no plano)</th>
                <th className="p-3">Sugestão (faltante)</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecomendacoes.length === 0 ? (
                <tr>
                  <td colSpan={13} className="p-6 text-center text-slate-500">
                    Nenhum município com os filtros atuais.
                  </td>
                </tr>
              ) : (
                filteredRecomendacoes.map((r) => (
                  <tr key={`${r.cidade}-${r.uf}`} className="border-t border-slate-800/80">
                    <td className="p-3">
                      <span
                        className={
                          r.prioridade === 'alta'
                            ? 'text-amber-400'
                            : r.prioridade === 'media'
                              ? 'text-cyan-400'
                              : 'text-slate-500'
                        }
                      >
                        {r.prioridade}
                      </span>
                    </td>
                    <td className="p-3 text-slate-500 font-mono text-xs">{r.uf}</td>
                    <td className="p-3 text-slate-200">{r.cidade}</td>
                    <td className="p-3 font-mono text-slate-400">{r.pop.toLocaleString('pt-BR')}</td>
                    <td className="p-3 font-mono text-slate-400 text-xs">
                      {fmtMercado(r.mercado?.renda_pc_mediana)}
                    </td>
                    <td className="p-3 font-mono text-slate-400 text-xs">
                      {fmtCount(r.mercado?.empresas_atuantes)}
                    </td>
                    <td className="p-3 font-mono text-slate-400 text-xs">
                      {fmtCount(r.mercado?.pessoal_assalariado)}
                    </td>
                    <td className="p-3 font-mono text-slate-400 text-xs">
                      {fmtCount(r.mercado?.score_corporativo)}
                    </td>
                    <td className="p-3 font-mono">{normalizePattern(r.pattern)}</td>
                    <td className="p-3 font-mono">{r.score.toLocaleString('pt-BR')}</td>
                    <td className="p-3 text-slate-300 text-xs">
                      {formatPlanoPresente(r)}
                    </td>
                    <td className="p-3 text-slate-400 text-xs">
                      {(r.modalidades_municipio?.length
                        ? r.modalidades_municipio
                        : r.suggested_entry?.modalidades)?.join(', ') ?? '—'}
                    </td>
                    <td className="p-3 text-slate-300 text-xs">
                      {formatSugestao(r)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs text-slate-500">
        Gerado: {new Date(data.generated_at).toLocaleString('pt-BR')} · {data.definition}
      </p>
    </div>
  );
}

function fmtMercado(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

function fmtCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('pt-BR');
}

function aggLabel(a: RecomendacaoCidade['agregador_presente']): string {
  if (a === 'wellhub') return 'Wellhub';
  if (a === 'totalpass') return 'TotalPass';
  return '';
}

function formatPlanoPresente(r: RecomendacaoCidade): string {
  if (r.plano_municipio && r.agregador_presente) {
    return `${aggLabel(r.agregador_presente)}: ${r.plano_municipio}`;
  }
  if (normalizePattern(r.pattern) === 'DESERTO') return '—';
  return '—';
}

function formatSugestao(r: RecomendacaoCidade): React.ReactNode {
  const espelho = r.cidade_espelho ? (
    <span className="text-slate-500 block mt-1">espelho: {r.cidade_espelho}</span>
  ) : null;

  if (r.sugestao_agregador === 'totalpass' && r.sugestao_plano) {
    return (
      <>
        TotalPass: {r.sugestao_plano}
        {r.sugestao_modalidades?.length ? (
          <span className="text-slate-500 block">{r.sugestao_modalidades.join(', ')}</span>
        ) : null}
        {espelho}
      </>
    );
  }
  if (r.sugestao_agregador === 'wellhub' && r.sugestao_plano) {
    return (
      <>
        Wellhub: {r.sugestao_plano}
        {r.sugestao_modalidades?.length ? (
          <span className="text-slate-500 block">{r.sugestao_modalidades.join(', ')}</span>
        ) : null}
        {espelho}
      </>
    );
  }
  if (r.sugestao_agregador === 'ambos') {
    return (
      <>
        Wellhub: {r.sugestao_plano_wh ?? '—'}
        <br />
        TotalPass: {r.sugestao_plano_tp ?? '—'}
        {r.sugestao_modalidades?.length ? (
          <span className="text-slate-500 block">{r.sugestao_modalidades.join(', ')}</span>
        ) : null}
        {espelho}
      </>
    );
  }
  // legado
  if (r.suggested_entry) {
    return (
      <>
        {r.suggested_entry.plano_wh_hint ?? '—'} / {r.suggested_entry.plano_tp_hint ?? '—'}
      </>
    );
  }
  return '—';
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="p-3 rounded-lg border border-slate-800 bg-slate-950/50">
      <div className="text-slate-500 text-xs">{label}</div>
      <div className="text-lg font-mono text-slate-100">{value.toLocaleString('pt-BR')}</div>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg border text-xs font-mono transition-colors ${
        active
          ? 'border-cyan-500/60 bg-cyan-500/15 text-cyan-300'
          : 'border-slate-700 bg-slate-950 text-slate-400 hover:border-slate-600 hover:text-slate-200'
      }`}
    >
      {label}
    </button>
  );
}

function SortableTh({
  label,
  keyId,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  keyId: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const active = sortKey === keyId;
  return (
    <th className="p-3">
      <button
        type="button"
        onClick={() => onSort(keyId)}
        className={`inline-flex items-center gap-1 text-left hover:text-slate-200 transition-colors ${
          active ? 'text-cyan-300' : ''
        }`}
        title={active ? (sortDir === 'asc' ? 'Ordem crescente' : 'Ordem decrescente') : 'Ordenar'}
      >
        <span>{label}</span>
        {active && sortDir === 'asc' ? (
          <ArrowUp className="w-3.5 h-3.5 shrink-0" aria-hidden />
        ) : active && sortDir === 'desc' ? (
          <ArrowDown className="w-3.5 h-3.5 shrink-0" aria-hidden />
        ) : (
          <span className="w-3.5 h-3.5 shrink-0 opacity-30 inline-flex items-center justify-center text-[10px]">↕</span>
        )}
      </button>
    </th>
  );
}
