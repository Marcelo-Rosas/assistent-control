# Inbox Regulatório (loop)

Candidatos brutos do **Regulatório CONFEF/CREF Refresh Loop**.

- Path: `data/raw/Regulatorio/inbox/YYYY-MM-DD/<slug>.txt`
- Front matter mínimo: `source_url`, `fetched_at`, `tema`, `decision` (`raw-only` | `ingest` | `human-amber`)
- Promoção a canônico / lista de `ingest-regulatorio-curado.ts` **só** se `decision=ingest` e dry-run OK
- Não misturar aggregadores nem Mercado aqui

Skill: `.agents/skills/regulatorio-confef-loop/SKILL.md`
