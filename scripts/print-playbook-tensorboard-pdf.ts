/**
 * PDF A4 do Playbook TensorBoard: paginado, sem cortar bloco.
 * Fonte: scratchpad Claude (artifact 6f6adead-...).
 *
 * Run: npx tsx scripts/print-playbook-tensorboard-pdf.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const SRC = path.join(
  process.env.LOCALAPPDATA || '',
  'Temp/claude/c--Users-marce-assistent-control/cd1a9a7f-5aec-43b4-aa9a-6dd1f66b2310/scratchpad/playbook-tensorboard.html',
);

const OUT_DIR = path.join(process.cwd(), 'output', 'pdf');
const PRINT_HTML = path.join(OUT_DIR, 'playbook-tensorboard.print.html');
const OUT_PDF = path.join(OUT_DIR, 'playbook-tensorboard.pdf');

const PRINT_CSS = `
html { data-theme: light; }
html, :root, :root:not([data-theme="light"]) {
  --paper:#ffffff !important; --surface:#f4f6f9 !important; --card:#ffffff !important;
  --ink:#141a22 !important; --ink-soft:#3f4a58 !important; --ink-faint:#6b7688 !important;
  --line:#d7dde5 !important; --line-soft:#e6eaf0 !important;
  --accent:#e8611c !important; --accent-soft:#f08a4b !important; --blue:#2f4bd6 !important;
  --ok:#1f8f74 !important; --warn:#c9791f !important;
  --shadow:none !important;
}
@page {
  size: A4;
  margin: 14mm 12mm 16mm 12mm;
}
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  background:#fff !important; color:var(--ink);
  font-size:10.5pt; line-height:1.45;
}
.wrap { max-width:none; margin:0; padding:0; }
.toc ol { columns:2; }
header, .toc, .note, .ex {
  break-inside: avoid;
  page-break-inside: avoid;
}
header { break-after: page; page-break-after: always; }
.toc { break-after: page; page-break-after: always; }
.card {
  break-before: page;
  page-break-before: always;
  margin: 0 0 8mm;
  border-radius: 10px;
  box-shadow: none;
}
.card .head, h1, h2, h3 {
  break-after: avoid;
  page-break-after: avoid;
}
.shot { break-inside: avoid; page-break-inside: avoid; }
.shot img {
  max-height: 88mm;
  width: 100%;
  height: auto;
  object-fit: contain;
  object-position: top center;
}
.uc, .eli5, .note, .ex, table.mini, .body ul {
  break-inside: avoid;
  page-break-inside: avoid;
}
footer { break-before: page; page-break-before: always; }
@media print {
  a { text-decoration: none; color: inherit; }
}
`;

function buildPrintHtml(raw: string): string {
  const bodyStart = raw.indexOf('<div class="wrap">');
  if (bodyStart < 0) throw new Error('playbook HTML missing .wrap');
  const head = raw.slice(0, bodyStart).replace('</style>', `${PRINT_CSS}\n</style>`);
  const body = raw.slice(bodyStart);
  return `<!doctype html>
<html lang="pt-BR" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head}
</head>
<body data-theme="light">
${body}
</body>
</html>
`;
}

async function main() {
  if (!fs.existsSync(SRC)) {
    throw new Error(`fonte nao encontrada: ${SRC}`);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const html = buildPrintHtml(fs.readFileSync(SRC, 'utf8'));
  fs.writeFileSync(PRINT_HTML, html, 'utf8');

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.emulateMedia({ media: 'print', colorScheme: 'light' });
  await page.goto(`file:///${PRINT_HTML.replace(/\\/g, '/')}`, {
    waitUntil: 'load',
    timeout: 180_000,
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.pdf({
    path: OUT_PDF,
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: `<div style="font-size:8px;width:100%;padding:4px 14mm 0;color:#6b7688;font-family:sans-serif;">Playbook do TensorBoard · GymSite</div>`,
    footerTemplate: `<div style="font-size:8px;width:100%;padding:0 14mm 4px;color:#6b7688;font-family:sans-serif;display:flex;justify-content:space-between;"><span>Uso interno</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    margin: { top: '16mm', bottom: '16mm', left: '0', right: '0' },
  });
  await browser.close();

  const st = fs.statSync(OUT_PDF);
  console.log('pdf', OUT_PDF);
  console.log('bytes', st.size);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
