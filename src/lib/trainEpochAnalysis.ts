import type { TrainProgress } from './aggregatorModel';

export type EpochRecord = TrainProgress & { epoch: number };

export type EarlyStopSimulation = {
  /** Epoch index (0-based) onde o treino pararia */
  stopAtEpoch: number;
  /** Melhor checkpoint por val_loss até o stop */
  checkpoint: EpochRecord;
};

export type EpochAnalysis = {
  configuredEpochs: number;
  final: EpochRecord | null;
  bestValAcc: EpochRecord | null;
  bestValLoss: EpochRecord | null;
  earlyStop: EarlyStopSimulation | null;
  suggestedEpochs: number | null;
  patience: number;
  minEpochsBeforeStop: number;
  overfitGapFinal: number | null;
  overfitGapAtBestVal: number | null;
  verdict: string;
  suggestion: string;
};

const DEFAULT_PATIENCE = 5;
const MIN_EPOCHS_BEFORE_STOP = 10;
const OVERFIT_GAP_WARN = 0.25;
const VAL_DEAD_THRESHOLD = 0.05;

function pct(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

function num(n: number | undefined, digits = 4): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

function findBestValLoss(history: EpochRecord[]): EpochRecord | null {
  let best: EpochRecord | null = null;
  for (const h of history) {
    const v = h.valLoss;
    if (v == null || !Number.isFinite(v)) continue;
    if (!best || v < best.valLoss!) best = h;
  }
  return best;
}

/** Entre epochs com val_acc máximo, prefere menor val_loss e depois epoch mais tardio. */
function findBestValAcc(history: EpochRecord[]): EpochRecord | null {
  let bestAcc = -1;
  let candidates: EpochRecord[] = [];

  for (const h of history) {
    const v = h.valAcc;
    if (v == null || !Number.isFinite(v)) continue;
    if (v > bestAcc + 1e-7) {
      bestAcc = v;
      candidates = [h];
    } else if (v >= bestAcc - 1e-7) {
      candidates.push(h);
    }
  }

  if (candidates.length === 0) return null;

  return candidates.reduce((best, h) => {
    const bl = best.valLoss ?? Infinity;
    const hl = h.valLoss ?? Infinity;
    if (hl < bl - 1e-7) return h;
    if (hl > bl + 1e-7) return best;
    return h.epoch > best.epoch ? h : best;
  });
}

function gapPp(trainAcc: number | undefined, valAcc: number | undefined): string {
  if (trainAcc == null || valAcc == null) return '—';
  const gap = (trainAcc - valAcc) * 100;
  if (gap > 0) return `${gap.toFixed(1)} pp`;
  if (gap < 0) return `val +${(-gap).toFixed(1)} pp`;
  return '0 pp';
}

/**
 * Early stop por val_loss — patience só conta após minEpochs
 * (evita “parar no epoch 1” quando o modelo ainda não aprendeu).
 */
function simulateEarlyStop(
  history: EpochRecord[],
  patience: number,
  minEpochs: number,
): EarlyStopSimulation | null {
  if (history.length <= minEpochs) return null;

  let bestValLoss = Infinity;
  let bestRecord: EpochRecord | null = null;
  let wait = 0;

  for (const h of history) {
    const vl = h.valLoss;
    if (vl == null || !Number.isFinite(vl)) continue;

    if (vl < bestValLoss - 1e-7) {
      bestValLoss = vl;
      bestRecord = h;
      wait = 0;
    } else if (h.epoch >= minEpochs) {
      wait += 1;
      if (wait >= patience && bestRecord) {
        return { stopAtEpoch: h.epoch, checkpoint: bestRecord };
      }
    }
  }
  return null;
}

export function analyzeEpochHistory(
  history: EpochRecord[],
  configuredEpochs: number,
  patience = DEFAULT_PATIENCE,
  minEpochsBeforeStop = MIN_EPOCHS_BEFORE_STOP,
): EpochAnalysis {
  const final = history.length > 0 ? history[history.length - 1]! : null;
  const bestValAcc = findBestValAcc(history);
  const bestValLoss = findBestValLoss(history);
  const earlyStop = simulateEarlyStop(history, patience, minEpochsBeforeStop);

  const overfitGapFinal =
    final?.valAcc != null ? final.acc - final.valAcc : null;
  const overfitGapAtBestVal =
    bestValAcc?.valAcc != null ? bestValAcc.acc - bestValAcc.valAcc : null;

  const maxValAcc = history.reduce((m, h) => Math.max(m, h.valAcc ?? 0), 0);
  const valSaturated = maxValAcc >= 0.99;

  let suggestedEpochs: number | null = configuredEpochs;
  if (valSaturated && bestValLoss) {
    suggestedEpochs = bestValLoss.epoch + 1;
  } else if (bestValAcc) {
    suggestedEpochs = bestValAcc.epoch + 1;
  } else if (bestValLoss) {
    suggestedEpochs = bestValLoss.epoch + 1;
  }

  if (
    suggestedEpochs != null &&
    earlyStop &&
    earlyStop.stopAtEpoch + 1 < suggestedEpochs
  ) {
    suggestedEpochs = Math.max(
      minEpochsBeforeStop,
      earlyStop.checkpoint.epoch + 1,
    );
  }

  if (suggestedEpochs != null) {
    suggestedEpochs = Math.max(1, Math.min(configuredEpochs, suggestedEpochs));
  }

  let verdict = 'ok';
  let suggestion = `Use ~${suggestedEpochs} epochs (melhor checkpoint).`;

  const finalValBelowBest =
    bestValAcc &&
    final &&
    (final.valAcc ?? 0) < (bestValAcc.valAcc ?? 0) - 0.01;
  const finalLossAboveBest =
    bestValLoss &&
    final &&
    (final.valLoss ?? Infinity) > (bestValLoss.valLoss ?? 0) * 1.05 + 1e-7;

  if (maxValAcc < VAL_DEAD_THRESHOLD) {
    verdict = 'val_zerada';
    suggestedEpochs = null;
    suggestion =
      'val ~0% em todos os epochs — não reduza epochs. Causa típica: split não estratificado (val só WH+TP). Use split por pattern; se persistir, limite é dados/classes.';
  } else if (overfitGapFinal != null && overfitGapFinal > OVERFIT_GAP_WARN) {
    verdict = 'overfitting';
    const bestEp = bestValAcc ? bestValAcc.epoch + 1 : suggestedEpochs ?? configuredEpochs;
    suggestion = `Overfitting no final (acc ${pct(final?.acc)} vs val ${pct(final?.valAcc)}). Melhor val no epoch ${bestEp} (${pct(bestValAcc?.valAcc)}). Próxima rodada: ~${suggestedEpochs} epochs, não ${configuredEpochs}.`;
  } else if (
    bestValAcc &&
    bestValAcc.epoch < (final?.epoch ?? 0) - 5 &&
    (finalValBelowBest || finalLossAboveBest)
  ) {
    verdict = 'parou_cedo';
    suggestion = `Validação piorou após epoch ${bestValAcc.epoch + 1}; ${configuredEpochs} epochs é excesso. Sugestão: ${suggestedEpochs}.`;
  } else if (valSaturated && bestValLoss) {
    verdict = 'ok';
    suggestion = `val ${pct(maxValAcc)} estável; melhor val_loss no epoch ${bestValLoss.epoch + 1}. ${configuredEpochs} epochs ok se val_loss segue caindo.`;
  } else if (final && (final.valAcc ?? 0) < 0.45) {
    verdict = 'baixa_val';
    suggestedEpochs = bestValAcc ? bestValAcc.epoch + 1 : suggestedEpochs;
    suggestion =
      'val < 45% — limite é dados/classes, não só epochs. Use a tabela de recomendações para decisão de mercado.';
  }

  return {
    configuredEpochs,
    final,
    bestValAcc,
    bestValLoss,
    earlyStop,
    suggestedEpochs,
    patience,
    minEpochsBeforeStop,
    overfitGapFinal,
    overfitGapAtBestVal,
    verdict,
    suggestion,
  };
}

export function epochAnalysisTableData(analysis: EpochAnalysis): {
  headers: string[];
  values: string[][];
} {
  const row = (label: string, r: EpochRecord | null, note: string): string[] => [
    label,
    r != null ? String(r.epoch + 1) : '—',
    num(r?.loss),
    pct(r?.acc),
    pct(r?.valAcc),
    num(r?.valLoss),
    note,
  ];

  const headers = ['Cenário', 'Epoch', 'Loss', 'Acc', 'Val', 'Val loss', 'Nota'];

  let earlyStopRow: string[];
  if (analysis.earlyStop) {
    const stop = analysis.earlyStop.stopAtEpoch + 1;
    const ck = analysis.earlyStop.checkpoint;
    earlyStopRow = [
      `Early stop (patience ${analysis.patience}, min ${analysis.minEpochsBeforeStop})`,
      String(stop),
      num(ck.loss),
      pct(ck.acc),
      pct(ck.valAcc),
      num(ck.valLoss),
      `parar epoch ${stop}; checkpoint epoch ${ck.epoch + 1}`,
    ];
  } else {
    earlyStopRow = [
      `Early stop (patience ${analysis.patience}, min ${analysis.minEpochsBeforeStop})`,
      '—',
      '—',
      '—',
      '—',
      '—',
      'não disparou após epoch mínimo',
    ];
  }

  const values: string[][] = [
    row(
      `Final (configurado ${analysis.configuredEpochs})`,
      analysis.final,
      analysis.verdict === 'overfitting' ? 'overfitting' : 'último epoch',
    ),
    row(
      'Melhor val_acc',
      analysis.bestValAcc,
      analysis.bestValAcc
        ? `gap ${gapPp(analysis.bestValAcc.acc, analysis.bestValAcc.valAcc)}`
        : '—',
    ),
    row(
      'Melhor val_loss',
      analysis.bestValLoss,
      'menor erro na validação',
    ),
    earlyStopRow,
    [
      'Sugestão epochs',
      analysis.suggestedEpochs != null ? String(analysis.suggestedEpochs) : '—',
      '—',
      '—',
      '—',
      '—',
      analysis.suggestion,
    ],
  ];

  if (analysis.overfitGapFinal != null) {
    values.push([
      'Gap acc − val (final)',
      '—',
      '—',
      pct(analysis.final?.acc),
      pct(analysis.final?.valAcc),
      `${(analysis.overfitGapFinal * 100).toFixed(1)} pp`,
      analysis.overfitGapFinal > OVERFIT_GAP_WARN ? 'alerta overfitting' : 'ok',
    ]);
  }

  return { headers, values };
}
