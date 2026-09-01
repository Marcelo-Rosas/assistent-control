/**
 * CLI: extrai schema de qualidade de uma academia TotalPass.
 * Run: npx tsx scripts/totalpass-detail-schema.ts <slug>
 */
import { fetchTotalPassDetailSchema } from './lib/totalpassDetailSchema.ts';

const slug =
  process.argv[2] || 'central-fitness-72f760e3-3d0c-412d-b1de-4f6fefceb0bf';

const schema = await fetchTotalPassDetailSchema(slug);
console.log(JSON.stringify(schema, null, 2));
