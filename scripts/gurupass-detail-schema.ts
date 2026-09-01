/**
 * CLI: extrai schema de enrich GuruPass de uma página de detalhe.
 * Run: npx tsx scripts/gurupass-detail-schema.ts <slug>
 */
import { fetchGuruPassDetailSchema } from './lib/gurupassDetailSchema.ts';

const slug = process.argv[2] || 'team-souza-fight';
const schema = await fetchGuruPassDetailSchema(slug);
console.log(JSON.stringify(schema, null, 2));
