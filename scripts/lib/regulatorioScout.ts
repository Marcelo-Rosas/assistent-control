/**
 * Scout HTTP / HTML parser for CONFEF notícias listing.
 * Live fetch may hit WAF `/challenge` — detect and fail clearly; use --scout-html-file.
 */
import { urlHash } from './regulatorioLoop.ts';

export const CONFEF_NOTICIAS_URL =
  'https://www.confef.org.br/comunicacao/noticias/';

export type ScoutCandidate = {
  url: string;
  title: string;
  date: string;
  hash: string;
};

export type ScoutFetchResult =
  | { ok: true; html: string; finalUrl: string }
  | { ok: false; reason: 'challenge' | 'http' | 'network'; status?: number; detail: string };

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export function looksLikeChallenge(html: string, finalUrl: string): boolean {
  const u = finalUrl.toLowerCase();
  if (u.includes('/challenge')) return true;
  const h = html.toLowerCase();
  return (
    h.includes('cf-browser-verification') ||
    h.includes('just a moment') ||
    (h.includes('/challenge') && html.length < 5000)
  );
}

/** Absolute URL join for relative hrefs. */
export function absolutize(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/**
 * Extract news article links from CONFEF listing HTML.
 * Heuristic: anchors under /comunicacao/noticias/ with path depth > listing.
 */
export function parseNoticiasHtml(
  html: string,
  baseUrl = CONFEF_NOTICIAS_URL,
  todayIso = new Date().toISOString().slice(0, 10),
): ScoutCandidate[] {
  const re =
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const byUrl = new Map<string, ScoutCandidate>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const abs = absolutize(m[1], baseUrl);
    if (!abs) continue;
    let parsed: URL;
    try {
      parsed = new URL(abs);
    } catch {
      continue;
    }
    // Require a dot boundary so lookalikes (evilconfef.org.br) são rejeitados;
    // aceita confef.org.br, www.confef.org.br e qualquer *.confef.org.br.
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'confef.org.br' && !host.endsWith('.confef.org.br')) continue;
    const path = parsed.pathname.replace(/\/+$/, '');
    if (!/\/comunicacao\/noticias\//i.test(path)) continue;
    // listing itself
    if (/\/comunicacao\/noticias$/i.test(path)) continue;
    // need an article slug after /noticias/
    const after = path.split(/\/comunicacao\/noticias\//i)[1];
    if (!after || after.length < 3) continue;

    const rawTitle = stripTags(m[2]).replace(/\s+/g, ' ').trim();
    const title = cleanTitle(rawTitle);
    if (!title || title.length < 4) continue;
    if (/\$\{/.test(title) || /\$\{/.test(abs)) continue;

    const date =
      extractDateNear(html, m.index) ||
      extractDateFromPath(after) ||
      extractDateFromTitle(rawTitle) ||
      todayIso;
    const hash = urlHash(parsed.toString(), title, date);
    const prev = byUrl.get(parsed.toString());
    if (!prev || title.length > prev.title.length) {
      byUrl.set(parsed.toString(), {
        url: parsed.toString(),
        title,
        date,
        hash,
      });
    }
  }
  return [...byUrl.values()];
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&');
}

function cleanTitle(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/\s*Autor:\s*.*$/i, '')
    .replace(/\s*Publicação:\s*.*$/i, '')
    .trim();
}

function extractDateFromTitle(title: string): string | null {
  const br = title.match(/(\d{2})\/(\d{2})\/(20\d{2})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return null;
}

function extractDateFromPath(slug: string): string | null {
  const m = slug.match(/(20\d{2})[-_/](\d{2})[-_/](\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function extractDateNear(html: string, index: number): string | null {
  const window = html.slice(Math.max(0, index - 200), index + 400);
  const m = window.match(/(20\d{2})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const br = window.match(/(\d{2})\/(\d{2})\/(20\d{2})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return null;
}

/** Parse urls_seen lines: `hash12 | url | title | ...` */
export function extractSeenUrlKeys(stateMarkdown: string): {
  hashes: Set<string>;
  urls: Set<string>;
} {
  const hashes = new Set<string>();
  const urls = new Set<string>();
  const section = stateMarkdown.match(
    /##\s*urls_seen\b([\s\S]*?)(?=\n##\s|\n*$)/i,
  );
  const body = section?.[1] ?? '';
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('<!--') || t.startsWith('_(')) continue;
    const parts = t.split('|').map((p) => p.trim());
    if (parts.length >= 2) {
      if (/^[a-f0-9]{8,64}$/i.test(parts[0])) hashes.add(parts[0].toLowerCase());
      if (/^https?:\/\//i.test(parts[1])) urls.add(parts[1]);
    }
  }
  return { hashes, urls };
}

export function filterNewCandidates(
  candidates: ScoutCandidate[],
  seen: { hashes: Set<string>; urls: Set<string> },
): ScoutCandidate[] {
  return candidates.filter((c) => {
    if (seen.urls.has(c.url)) return false;
    const short = c.hash.slice(0, 12).toLowerCase();
    if (seen.hashes.has(short) || seen.hashes.has(c.hash.toLowerCase())) {
      return false;
    }
    return true;
  });
}

export async function fetchNoticiasHtml(
  url = CONFEF_NOTICIAS_URL,
): Promise<ScoutFetchResult> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      redirect: 'follow',
    });
    const finalUrl = res.url || url;
    const html = await res.text();
    if (looksLikeChallenge(html, finalUrl)) {
      return {
        ok: false,
        reason: 'challenge',
        status: res.status,
        detail: `WAF/challenge em ${finalUrl}`,
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        reason: 'http',
        status: res.status,
        detail: `HTTP ${res.status}`,
      };
    }
    return { ok: true, html, finalUrl };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/redirect count exceeded/i.test(msg)) {
      return {
        ok: false,
        reason: 'challenge',
        detail: `redirect loop (provável /challenge): ${msg}`,
      };
    }
    return { ok: false, reason: 'network', detail: msg.slice(0, 200) };
  }
}
