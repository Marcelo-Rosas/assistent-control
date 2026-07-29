# Commit — regras

## Quando commitar

- Só quando **você pedir** explicitamente (agente não commita por iniciativa).
- PR separado de dados brutos (`data/raw/`, `data/processed/*.json` grandes).

## Antes do commit

```bash
git status
git diff
git log -5 --oneline
```

## O que incluir

| Incluir | Excluir (default) |
|---------|-------------------|
| `supabase/migrations/*.sql` | `.env.local` |
| `supabase/functions/**` | `data/processed/` (MB+) |
| `src/**`, `scripts/**`, `tests/**` | `data/raw/Agregadores/*.json` |
| `Docs/ops/**`, notebooks `.ipynb` pequenos | secrets, tokens, PDFs |

## Mensagem (estilo)

- 1–2 frases, foco no **porquê**
- Imperativo: `fix`, `feat`, `chore`, `docs`

Exemplos:

```
feat(rag): harden match_chunks + filterByCityPriority no edge

docs(ops): guias commit/deploy/testes/jupyter
```

## Proibido

- `git push --force` em `main` sem pedido explícito
- `git commit --amend` se commit já foi pushado
- `--no-verify` sem pedido
- Alterar `git config` do usuário

## PR (se pedido)

```bash
git push -u origin HEAD
gh pr create --title "..." --body "..."
```

Base: `main`. Incluir test plan com comandos rodados.
