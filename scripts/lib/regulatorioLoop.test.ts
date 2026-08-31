import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  urlHash,
  parseDecision,
  shouldSkipTick,
  buildInboxDoc,
  assertIsoDate,
  assertAllowlistedUrl,
  assertRegulatorioGroupId,
  extractLastTickIso,
  appendTickToState,
} from './regulatorioLoop.ts';

describe('urlHash', () => {
  it('is stable for same inputs', () => {
    const a = urlHash('https://www.confef.org.br/x', 'Titulo', '2026-08-01');
    const b = urlHash('https://www.confef.org.br/x', 'Titulo', '2026-08-01');
    assert.equal(a, b);
    assert.equal(a.length, 64);
  });
  it('changes when title changes', () => {
    const a = urlHash('https://www.confef.org.br/x', 'A', '2026-08-01');
    const b = urlHash('https://www.confef.org.br/x', 'B', '2026-08-01');
    assert.notEqual(a, b);
  });
});

describe('parseDecision', () => {
  it('accepts ingest', () => {
    assert.equal(parseDecision('ingest'), 'ingest');
  });
  it('rejects garbage', () => {
    assert.throws(() => parseDecision('maybe'));
  });
});

describe('shouldSkipTick', () => {
  it('skips when last tick < 20h ago', () => {
    const now = new Date('2026-08-03T15:00:00Z');
    const last = '2026-08-03T00:00:00Z';
    assert.equal(shouldSkipTick(last, now, 20), true);
  });
  it('does not skip when never run', () => {
    assert.equal(shouldSkipTick(null, new Date(), 20), false);
  });
});

describe('assertAllowlistedUrl', () => {
  it('allows confef.org.br', () => {
    assert.equal(
      assertAllowlistedUrl('https://www.confef.org.br/comunicacao/noticias/1'),
      'https://www.confef.org.br/comunicacao/noticias/1',
    );
  });
  it('allows cref host', () => {
    assert.match(
      assertAllowlistedUrl('https://www.cref1.org.br/anuidades'),
      /cref1\.org\.br/i,
    );
  });
  it('rejects random host', () => {
    assert.throws(() => assertAllowlistedUrl('https://evil.example/x'));
  });
  it('rejects substring-lookalike hosts', () => {
    assert.throws(() => assertAllowlistedUrl('https://cref.evil.com/x'));
    assert.throws(() => assertAllowlistedUrl('https://micref.io/x'));
    assert.throws(() => assertAllowlistedUrl('https://evilcref.org.br/x'));
  });
  it('rejects invalid URL', () => {
    assert.throws(() => assertAllowlistedUrl('not-a-url'));
  });
  it('rejects URL longer than 2048', () => {
    const long = `https://www.confef.org.br/${'a'.repeat(2100)}`;
    assert.throws(() => assertAllowlistedUrl(long));
  });
});

describe('assertIsoDate', () => {
  it('accepts YYYY-MM-DD', () => {
    assert.equal(assertIsoDate('2026-08-03'), '2026-08-03');
  });
  it('rejects garbage', () => {
    assert.throws(() => assertIsoDate('03/08/2026'));
  });
});

describe('assertRegulatorioGroupId', () => {
  it('rejects Wellhub prefix', () => {
    assert.throws(() =>
      assertRegulatorioGroupId('553fa8d6-0000-0000-0000-000000000000'),
    );
  });
  it('accepts regulatorio uuid', () => {
    assert.equal(
      assertRegulatorioGroupId('b7dad505-2d2a-49a9-bbaf-d4b9c4929dea'),
      'b7dad505-2d2a-49a9-bbaf-d4b9c4929dea',
    );
  });
});

describe('buildInboxDoc', () => {
  it('includes front matter keys', () => {
    const doc = buildInboxDoc(
      {
        source_url: 'https://www.confef.org.br/comunicacao/noticias/1',
        fetched_at: '2026-08-03T12:00:00Z',
        tema: 'resolucao_confef',
        decision: 'raw-only',
      },
      'corpo da noticia',
    );
    assert.match(doc, /source_url:/);
    assert.match(doc, /decision: raw-only/);
    assert.match(doc, /corpo da noticia/);
  });
});

describe('state helpers', () => {
  const sample = `# x

## last_tick

- **ISO:** _(nunca)_
- **Resultado:** bootstrap
- **ingest_count:** 0
- **amber_count:** 0

## urls_seen

_(vazio)_

## decisions (ticks recentes)

_(vazio)_
`;

  it('extractLastTickIso returns null for bootstrap', () => {
    assert.equal(extractLastTickIso(sample), null);
  });

  it('appendTickToState sets ISO', () => {
    const next = appendTickToState(sample, {
      iso: '2026-08-03T15:00:00Z',
      result: 'ok',
      ingestCount: 0,
      amberCount: 0,
      decisionLine: '2026-08-03 | https://www.confef.org.br/x | drop | teste',
    });
    assert.match(next, /\*\*ISO:\*\* 2026-08-03T15:00:00Z/);
    assert.match(next, /drop \| teste/);
    assert.equal(extractLastTickIso(next), '2026-08-03T15:00:00Z');
  });
});
