/**
 * Tick dry-run do loop Regulatório CONFEF/CREF.
 *
 * Run: npm run loop:regulatorio-tick -- --force --candidate-url ... --decision drop ...
 * Scout: npm run loop:regulatorio-tick -- --force --scout-noticias
 *        npm run loop:regulatorio-tick -- --force --scout-html-file path.html
 *
 * Nunca chama ingest apply. Nunca loga secrets.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  appendTickToState,
  assertAllowlistedUrl,
  assertIsoDate,
  buildInboxDoc,
  extractLastTickIso,
  parseDecision,
  shouldSkipTick,
  urlHash,
  type TriageDecision,
} from './lib/regulatorioLoop.ts';
import {
  CONFEF_NOTICIAS_URL,
  extractSeenUrlKeys,
  fetchNoticiasHtml,
  filterNewCandidates,
  parseNoticiasHtml,
} from './lib/regulatorioScout.ts';

const ROOT = process.cwd();
const STATE_PATH = path.join(ROOT, 'Docs', 'ops', 'regulatorio-loop-state.md');

type Args = {
  force: boolean;
  writeInbox: boolean;
  updateState: boolean;
  scoutNoticias: boolean;
  scoutHtmlFile?: string;
  candidateUrl?: string;
  title?: string;
  date?: string;
  decision?: string;
  tema?: string;
  bodyFile?: string;
  reason?: string;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    force: false,
    writeInbox: false,
    updateState: true,
    scoutNoticias: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`flag ${a} exige valor`);
      return v;
    };
    if (a === '--force') out.force = true;
    else if (a === '--write-inbox') out.writeInbox = true;
    else if (a === '--update-state') out.updateState = true;
    else if (a === '--no-update-state') out.updateState = false;
    else if (a === '--scout-noticias') out.scoutNoticias = true;
    else if (a === '--scout-html-file') out.scoutHtmlFile = next();
    else if (a === '--candidate-url') out.candidateUrl = next();
    else if (a === '--title') out.title = next();
    else if (a === '--date') out.date = next();
    else if (a === '--decision') out.decision = next();
    else if (a === '--tema') out.tema = next();
    else if (a === '--body-file') out.bodyFile = next();
    else if (a === '--reason') out.reason = next();
    else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`arg desconhecido: ${a}`);
    }
  }
  return out;
}

function printHelp(): void {
  console.log(`Usage: npm run loop:regulatorio-tick -- [flags]

  --force              ignora skip <20h
  --scout-noticias     fetch live CONFEF notícias (pode falhar no WAF)
  --scout-html-file P  parse HTML salvo (browser/fixture)
  --write-inbox        grava data/raw/Regulatorio/inbox/YYYY-MM-DD/
  --update-state       patch state (default)
  --no-update-state    não grava state
  --candidate-url URL  candidato allowlist (modo Analyst manual)
  --title TEXT
  --date YYYY-MM-DD
  --decision drop|raw-only|ingest|human-amber
  --tema TEXT
  --body-file PATH
  --reason TEXT
`);
}

function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'item';
}

function emit(payload: Record<string, unknown>, code: number): never {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(code);
}

async function runScout(args: Args, stateRaw: string, now: Date): Promise<void> {
  let html: string;
  let source: string;

  if (args.scoutHtmlFile) {
    const abs = path.isAbsolute(args.scoutHtmlFile)
      ? args.scoutHtmlFile
      : path.join(ROOT, args.scoutHtmlFile);
    html = fs.readFileSync(abs, 'utf-8');
    source = `html-file:${path.relative(ROOT, abs).replace(/\\/g, '/')}`;
  } else {
    const fetched = await fetchNoticiasHtml(CONFEF_NOTICIAS_URL);
    if (!fetched.ok) {
      emit(
        {
          mode: 'scout',
          error: fetched.detail,
          reason: fetched.reason,
          hint:
            'CONFEF WAF bloqueia fetch headless. Use browser → salvar HTML → --scout-html-file',
        },
        1,
      );
    }
    html = fetched.html;
    source = `live:${fetched.finalUrl}`;
  }

  const today = now.toISOString().slice(0, 10);
  const all = parseNoticiasHtml(html, CONFEF_NOTICIAS_URL, today);
  const seen = extractSeenUrlKeys(stateRaw);
  const neu = filterNewCandidates(all, seen);

  let stateUpdated = false;
  if (args.updateState && stateRaw) {
    const next = appendTickToState(stateRaw, {
      iso: now.toISOString(),
      result: `scout:${neu.length}_new/${all.length}_total`,
      ingestCount: 0,
      amberCount: 0,
    });
    fs.writeFileSync(STATE_PATH, next, 'utf-8');
    stateUpdated = true;
  }

  emit(
    {
      mode: 'scout',
      skipped: false,
      source,
      candidatesTotal: all.length,
      candidatesNew: neu.length,
      candidates: neu.map((c) => ({
        url: c.url,
        title: c.title,
        date: c.date,
        hash: c.hash.slice(0, 12),
        suggestedDecision: suggestDecision(c.title),
      })),
      stateUpdated,
      note: 'Sem ingest automático — rode tick com --candidate-url + --decision',
    },
    0,
  );
}

function suggestDecision(title: string): 'drop' | 'human-amber' | 'raw-only' {
  const t = title.toLowerCase();
  if (
    /anuidade|resolu[cç][aã]o|inscri[cç][aã]o|registro|cref|carteira|fiscaliza/i.test(
      t,
    )
  ) {
    return 'human-amber';
  }
  if (/copa|semin[aá]rio|palestra|encontro|pesquisa|comenta/i.test(t)) {
    return 'drop';
  }
  return 'raw-only';
}

async function main(): Promise<void> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    emit({ error: e instanceof Error ? e.message : String(e) }, 1);
  }

  const now = new Date();
  const stateRaw = fs.existsSync(STATE_PATH)
    ? fs.readFileSync(STATE_PATH, 'utf-8')
    : '';
  const lastIso = extractLastTickIso(stateRaw);

  if (!args.force && shouldSkipTick(lastIso, now, 20)) {
    let stateUpdated = false;
    if (args.updateState && stateRaw) {
      const next = appendTickToState(stateRaw, {
        iso: now.toISOString(),
        result: 'skipped',
        ingestCount: 0,
        amberCount: 0,
      });
      fs.writeFileSync(STATE_PATH, next, 'utf-8');
      stateUpdated = true;
    }
    emit(
      {
        skipped: true,
        candidates: 0,
        written: [],
        stateUpdated,
        lastTick: lastIso,
      },
      0,
    );
  }

  if (args.scoutNoticias || args.scoutHtmlFile) {
    await runScout(args, stateRaw, now);
    return;
  }

  if (!args.candidateUrl) {
    let stateUpdated = false;
    if (args.updateState && stateRaw) {
      const next = appendTickToState(stateRaw, {
        iso: now.toISOString(),
        result: 'empty',
        ingestCount: 0,
        amberCount: 0,
      });
      fs.writeFileSync(STATE_PATH, next, 'utf-8');
      stateUpdated = true;
    }
    emit(
      {
        skipped: false,
        candidates: 0,
        written: [] as string[],
        stateUpdated,
      },
      0,
    );
  }

  try {
    const url = assertAllowlistedUrl(args.candidateUrl!);
    const date = assertIsoDate(args.date ?? now.toISOString().slice(0, 10));
    const title = (args.title ?? '').trim() || 'untitled';
    if (!args.decision) throw new Error('--decision obrigatório com candidate');
    const decision = parseDecision(args.decision);
    const tema = (args.tema ?? 'resolucao_confef').trim();
    const hash = urlHash(url, title, date);
    const reason = (args.reason ?? decision).trim();
    const day = date.slice(0, 10);

    const written: string[] = [];
    const writeable: TriageDecision[] = [
      'raw-only',
      'ingest',
      'human-amber',
    ];
    if (args.writeInbox && writeable.includes(decision)) {
      let body = '';
      if (args.bodyFile) {
        const abs = path.isAbsolute(args.bodyFile)
          ? args.bodyFile
          : path.join(ROOT, args.bodyFile);
        body = fs.readFileSync(abs, 'utf-8');
      }
      const doc = buildInboxDoc(
        {
          source_url: url,
          fetched_at: now.toISOString(),
          tema,
          decision,
        },
        body || title,
      );
      const dir = path.join(
        ROOT,
        'data',
        'raw',
        'Regulatorio',
        'inbox',
        day,
      );
      fs.mkdirSync(dir, { recursive: true });
      const outPath = path.join(dir, `${slugify(title)}.txt`);
      fs.writeFileSync(outPath, doc, 'utf-8');
      written.push(path.relative(ROOT, outPath).replace(/\\/g, '/'));
    }

    let stateUpdated = false;
    if (args.updateState && stateRaw) {
      const decisionLine = `${day} | ${url} | ${decision} | ${reason}`;
      const urlSeenLine = `${hash.slice(0, 12)} | ${url} | ${title} | ${day} | ${day} | ${decision}`;
      const next = appendTickToState(stateRaw, {
        iso: now.toISOString(),
        result: decision,
        ingestCount: decision === 'ingest' ? 1 : 0,
        amberCount: decision === 'human-amber' ? 1 : 0,
        decisionLine,
        urlSeenLine,
      });
      fs.writeFileSync(STATE_PATH, next, 'utf-8');
      stateUpdated = true;
    }

    emit(
      {
        skipped: false,
        candidates: 1,
        url,
        title,
        date,
        decision,
        tema,
        hash,
        written,
        stateUpdated,
      },
      0,
    );
  } catch (e) {
    emit({ error: e instanceof Error ? e.message : String(e) }, 1);
  }
}

main();
