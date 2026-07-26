/**
 * Enriquecimento prévio TotalPass via Jina Reader (r.jina.ai).
 * Rodar ANTES da ingestão: npx tsx scripts/enrich-totalpass.ts
 *
 * Input:  data/raw/totalpass-sp-capital.json
 * Output: data/processed/totalpass-sp-capital-enriched.json
 */
import fs from 'fs/promises';
import path from 'path';

type AcademiaOriginal = {
  nome: string;
  cidade: string;
  bairro: string;
  endereco: string;
  distancia: string;
  plano_minimo: string;
  valor_plano_minimo: string;
};

type ModalidadeExtraida = {
  nome: string;
  plano_minimo: string;
  descricao_extra?: string;
};

type AcademiaEnriquecida = AcademiaOriginal & {
  totalpass_url: string;
  modalidades_extraidas: ModalidadeExtraida[];
  descricao_curta: string;
  enriquecimento_status: 'success' | 'failed' | 'skipped';
};

function gerarSlugTotalPass(nome: string): string {
  return nome
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 60);
}

/** Normaliza nome de modalidade para vocabulário fechado (labels legíveis). */
function normalizarModalidade(nome: string): string {
  const n = nome.toLowerCase().trim();
  if (n.includes('muay')) return 'Muay Thai';
  if (n.includes('jiu')) return 'Jiu Jitsu';
  if (n.includes('boxe') || n.includes('boxing')) return 'Boxe';
  if (n.includes('capoeira')) return 'Capoeira';
  if (n.includes('pilates')) return 'Pilates';
  if (n.includes('yoga')) return 'Yoga';
  if (n.includes('nata') || n.includes('swim')) return 'Natação';
  if (n.includes('funcional')) return 'Treinamento Funcional';
  if (n.includes('crossfit')) return 'Crossfit';
  if (n.includes('dança') || n.includes('danca') || n.includes('pole')) return 'Dança';
  if (n.includes('muscul')) return 'Musculação';
  if (n.includes('fisio')) return 'Fisioterapia';
  if (n.includes('spa')) return 'Spa';
  if (n.includes('massag')) return 'Massoterapia';
  if (n.includes('tênis') || n.includes('tenis')) return 'Tênis';
  return nome.trim();
}

function extrairModalidades(texto: string): ModalidadeExtraida[] {
  const modalidades: ModalidadeExtraida[] = [];
  const seen = new Set<string>();

  // "Nome\n\nDisponível a partir do plano TP X"
  // "Nome\n\n(descrição)\n\nDisponível a partir do plano TP X"
  const regex =
    /([A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ][a-záéíóúâêîôûãõç\s\-]+?)\s*\n+(?:\(([^)]+)\)\s*\n+)?Disponível a partir do plano\s+(TP\s*\w+)/gi;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(texto)) !== null) {
    const nomeBruto = match[1].trim();
    const descricao = match[2]?.trim();
    const plano = match[3].replace(/\s+/g, ' ').trim();
    const nome = normalizarModalidade(nomeBruto);

    if (!seen.has(nome)) {
      seen.add(nome);
      modalidades.push({
        nome,
        plano_minimo: plano,
        descricao_extra: descricao,
      });
    }
  }

  if (modalidades.length === 0) {
    const keywords = [
      'Musculação',
      'Funcional',
      'Crossfit',
      'Jiu Jitsu',
      'Muay Thai',
      'Boxe',
      'Capoeira',
      'Pilates',
      'Yoga',
      'Natação',
      'Dança',
      'Fisioterapia',
      'Spa',
      'Massagem',
      'Tênis',
      'Lutas',
    ];
    const textLower = texto.toLowerCase();
    for (const kw of keywords) {
      if (textLower.includes(kw.toLowerCase()) && !seen.has(kw)) {
        seen.add(kw);
        modalidades.push({ nome: kw, plano_minimo: 'TP 1' });
      }
    }
  }

  return modalidades;
}

async function enriquecerAcademia(
  ac: AcademiaOriginal,
  index: number,
  total: number,
): Promise<AcademiaEnriquecida> {
  const slug = gerarSlugTotalPass(ac.nome);
  const url = `https://totalpass.com/br/academias/${slug}/`;

  console.log(`[${index + 1}/${total}] ${ac.nome} → ${url}`);

  try {
    const jinaUrl = `https://r.jina.ai/${url}`;
    const response = await fetch(jinaUrl, {
      method: 'GET',
      headers: { Accept: 'text/plain' },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const texto = await response.text();
    const modalidades = extrairModalidades(texto);

    const descMatch = texto.match(/(?:descrição|sobre|apresenta)([\s\S]{0,300})/i);
    const descricao = descMatch
      ? descMatch[1].trim().substring(0, 200) + (descMatch[1].length > 200 ? '...' : '')
      : '';

    console.log(`  OK ${modalidades.length} modalidades extraídas`);

    return {
      ...ac,
      totalpass_url: url,
      modalidades_extraidas: modalidades,
      descricao_curta: descricao,
      enriquecimento_status: 'success',
    };
  } catch (error) {
    console.warn(`  FAIL: ${error instanceof Error ? error.message : String(error)}`);
    return {
      ...ac,
      totalpass_url: url,
      modalidades_extraidas: [],
      descricao_curta: '',
      enriquecimento_status: 'failed',
    };
  }
}

async function main() {
  const rawDir = path.join(process.cwd(), 'data/raw');
  const jsonPath = path.join(rawDir, 'totalpass-sp-capital.json');
  const txtPath = path.join(rawDir, 'totalpass-sp-capital.txt');
  const outputDir = path.join(process.cwd(), 'data/processed');
  const outputPath = path.join(outputDir, 'totalpass-sp-capital-enriched.json');

  await fs.mkdir(outputDir, { recursive: true });

  console.log('Lendo dataset original...');
  let rawData: string;
  let inputPath = jsonPath;
  try {
    rawData = await fs.readFile(jsonPath, 'utf-8');
  } catch {
    try {
      inputPath = txtPath;
      rawData = await fs.readFile(txtPath, 'utf-8');
      console.log(`(usando ${txtPath})`);
    } catch (e) {
      console.error(`Arquivo ausente. Coloque JSON/TXT em:`);
      console.error(`  ${jsonPath}`);
      console.error(`  ou ${txtPath}`);
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  }
  console.log(`Fonte: ${inputPath}`);

  const academias: AcademiaOriginal[] = JSON.parse(rawData);
  if (!Array.isArray(academias)) {
    console.error('JSON inválido — esperado array.');
    process.exit(1);
  }
  console.log(`${academias.length} academias encontradas\n`);

  const enriquecidas: AcademiaEnriquecida[] = [];

  for (let i = 0; i < academias.length; i++) {
    const enriquecida = await enriquecerAcademia(academias[i], i, academias.length);
    enriquecidas.push(enriquecida);

    if (i < academias.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  await fs.writeFile(outputPath, JSON.stringify(enriquecidas, null, 2), 'utf-8');

  const successCount = enriquecidas.filter((a) => a.enriquecimento_status === 'success').length;
  const failedCount = enriquecidas.filter((a) => a.enriquecimento_status === 'failed').length;

  console.log(`\nConcluído`);
  console.log(`  Sucesso: ${successCount}/${academias.length}`);
  console.log(`  Falhas:  ${failedCount}/${academias.length}`);
  console.log(`  Output:  ${outputPath}`);
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
