/**
 * Shared PDF text cleanup + recursive character splitting (LangChain-style).
 * Reusable by Mercado and other PDF ingest scripts.
 */

export const DEFAULT_CHUNK_SIZE = 1000; // target ~800–1200
export const DEFAULT_CHUNK_OVERLAP = 120; // target ~100–150
export const DEFAULT_SEPARATORS = ['\n\n', '\n', '. ', ' ', ''] as const;

/** Fix common PDF extraction junk, then collapse whitespace. */
export function normalizePdfText(text: string): string {
  return text
    // hyphenation across line breaks: "aca-\ndemias" → "academias"
    .replace(/(\p{L})-\s*\n\s*(\p{L})/gu, '$1$2')
    // soft hyphen
    .replace(/\u00ad/g, '')
    // TOC leader dots / underscores explode tokenizer (mxbai ~512 tok)
    .replace(/[.\u2026_]{4,}/g, ' ')
    .replace(/\n\s*\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * RecursiveCharacterTextSplitter-style split without LangChain dependency.
 * Tries separators in order; when a piece still exceeds chunkSize, recurses
 * with the remaining separators; final fallback is a hard character slice.
 */
export function recursiveCharacterTextSplit(
  text: string,
  options?: {
    chunkSize?: number;
    chunkOverlap?: number;
    separators?: readonly string[];
    minChunkLength?: number;
  },
): string[] {
  const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const chunkOverlap = Math.min(
    options?.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP,
    Math.max(0, chunkSize - 1),
  );
  const separators = [...(options?.separators ?? DEFAULT_SEPARATORS)];
  const minChunkLength = options?.minChunkLength ?? 20;

  const trimmed = text.trim();
  if (!trimmed) return [];

  const raw = splitText(trimmed, chunkSize, separators);
  const merged = mergeSplits(raw, chunkSize, chunkOverlap);
  return merged.filter((c) => c.trim().length >= minChunkLength).map((c) => c.trim());
}

function splitText(text: string, chunkSize: number, separators: string[]): string[] {
  let separator = separators[separators.length - 1] ?? '';
  let newSeparators: string[] = [];

  for (let i = 0; i < separators.length; i++) {
    const s = separators[i]!;
    if (s === '') {
      separator = s;
      break;
    }
    if (text.includes(s)) {
      separator = s;
      newSeparators = separators.slice(i + 1);
      break;
    }
  }

  const splits =
    separator === ''
      ? Array.from(text) // char-level
      : text.split(separator);

  const goodSplits: string[] = [];
  const acc: string[] = [];

  for (const s of splits) {
    if (s.length < chunkSize) {
      acc.push(s);
    } else {
      if (acc.length) {
        goodSplits.push(...mergeSplits(acc, chunkSize, 0, separator));
        acc.length = 0;
      }
      if (newSeparators.length) {
        goodSplits.push(...splitText(s, chunkSize, newSeparators));
      } else {
        goodSplits.push(s);
      }
    }
  }
  if (acc.length) {
    goodSplits.push(...mergeSplits(acc, chunkSize, 0, separator));
  }
  return goodSplits;
}

function mergeSplits(
  splits: string[],
  chunkSize: number,
  chunkOverlap: number,
  separator = ' ',
): string[] {
  const docs: string[] = [];
  const current: string[] = [];
  let total = 0;
  const sepLen = separator.length;

  for (const d of splits) {
    const len = d.length;
    if (total + len + (current.length ? sepLen : 0) > chunkSize && current.length) {
      const doc = current.join(separator).trim();
      if (doc) docs.push(doc);

      while (
        total > chunkOverlap ||
        (total + len + (current.length ? sepLen : 0) > chunkSize && total > 0)
      ) {
        total -= current[0]!.length + (current.length > 1 ? sepLen : 0);
        current.shift();
      }
    }
    current.push(d);
    total += len + (current.length > 1 ? sepLen : 0);
  }

  const doc = current.join(separator).trim();
  if (doc) docs.push(doc);
  return docs;
}
