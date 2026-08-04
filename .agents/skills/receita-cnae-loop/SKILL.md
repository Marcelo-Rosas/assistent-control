---
name: receita-cnae-loop
description: >-
  Loop Scout Receita CNAE 9313100: KPIs mensais (entrantes/baixados) + diff de
  dump; alimenta public/receita e dashboard /receita. Use ao atualizar CSV
  Receita, regenerar KPIs ou diagnosticar o dashboard de academias.
---

# Receita CNAE 9313100 Loop

## Quando usar

- Novo CSV em `data/processed/receita-cnae-9313100-principal-*.csv`
- Regenerar KPIs / diff
- Dashboard `/receita` vazio ou desatualizado

## Quando NÃO usar

- Download zip Receita (job separado)
- Ingest RAG (`ingest:receita`) — fora deste loop
- Upsert Supabase (fase 2)

## Passos

1. Ler `Docs/ops/receita-loop-state.md`
2. Garantir CSVs:
   - `receita-cnae-9313100-principal-ativos.csv`
   - `receita-cnae-9313100-principal-ativo-baixada.csv`
3. Rodar:

```powershell
npm run scout:receita-kpis -- --month YYYY-MM
```

4. Verificar `public/receita/kpis-latest.json` — `totals.ativos > 0`
5. Segundo run mesmo CSV → `diff_novos=0` e `diff_baixados=0`
7. Abrir `/receita` — seletor de mês + drill UF → cidade → bairro
8. Atualizar state.md

### Opcional — blog trimestral

```powershell
npm run report:receita-blog -- --quarter YYYY-QN --n 3
```

Depois: skill `.agents/skills/gymsite-blog-receita/` nas fichas → `Docs/blog/gymsite/`.  
Spec: `Docs/superpowers/specs/2026-08-04-receita-blog-gymsite-design.md`

## Artefatos

- `data/processed/receita-kpis-{mês}.json`
- `data/processed/receita-delta-{mês}.json`
- `public/receita/kpis-*.json`, `months.json`
- Snapshot: `data/processed/receita-cnpj-snapshot-prev.json`
- Blog: `data/processed/receita-blog/{quarter}/` + `Docs/blog/gymsite/`

## Spec

`Docs/superpowers/specs/2026-08-03-receita-cnae-loop-design.md`  
Blog: `Docs/superpowers/specs/2026-08-04-receita-blog-gymsite-design.md`
