import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseNoticiasHtml,
  filterNewCandidates,
  extractSeenUrlKeys,
  looksLikeChallenge,
  CONFEF_NOTICIAS_URL,
} from './regulatorioScout.ts';

const SAMPLE = `
<html><body>
<a href="/comunicacao/noticias/1846">PeNSE 2024 Autor: Comunicação Publicação: 31/07/2026</a>
<a href="/comunicacao/noticias/1837">Cinco novos CREFs são criados Publicação: 13/06/2026</a>
<a href="/comunicacao/noticias/">Notícias</a>
<a href="https://evil.example/comunicacao/noticias/9">fake</a>
</body></html>
`;

describe('parseNoticiasHtml', () => {
  it('extracts confef article links', () => {
    const c = parseNoticiasHtml(SAMPLE, CONFEF_NOTICIAS_URL, '2026-08-03');
    assert.ok(c.length >= 2);
    assert.ok(c.some((x) => x.url.includes('/1846')));
    assert.ok(c.some((x) => /CREFs/i.test(x.title)));
  });
  it('rejects lookalike host without dot boundary', () => {
    const html =
      '<a href="https://evilconfef.org.br/comunicacao/noticias/9">spoof</a>';
    const c = parseNoticiasHtml(html, CONFEF_NOTICIAS_URL, '2026-08-03');
    assert.equal(c.length, 0);
  });
});

describe('filterNewCandidates', () => {
  it('drops urls already in state', () => {
    const all = parseNoticiasHtml(SAMPLE, CONFEF_NOTICIAS_URL, '2026-08-03');
    const one = all[0];
    const seen = extractSeenUrlKeys(
      `## urls_seen\n\nabc | ${one.url} | t | 2026-08-03 | 2026-08-03 | drop\n`,
    );
    const neu = filterNewCandidates(all, seen);
    assert.equal(neu.some((x) => x.url === one.url), false);
    assert.ok(neu.length < all.length);
  });
});

describe('looksLikeChallenge', () => {
  it('detects /challenge url', () => {
    assert.equal(looksLikeChallenge('<html/>', 'https://www.confef.org.br/challenge'), true);
  });
});
