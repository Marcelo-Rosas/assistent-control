# Jupyter — regras

## Ambiente

```bash
# venv na raiz do repo
.\.venv\Scripts\activate          # Windows
pip install jupyter supabase python-dotenv httpx
```

Env: `.env.local` na raiz (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, group IDs).

## Subir servidor (1 instância)

Portas 8888/8889/8890 ocupadas = instâncias velhas. Matar e subir limpo:

```powershell
Get-NetTCPConnection -LocalPort 8888,8889,8890 -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

.\.venv\Scripts\jupyter.exe notebook --notebook-dir=notebooks --port=8888 --no-browser
```

Abrir: http://localhost:8888/tree

## Notebooks por domínio

| Notebook | Grupo / foco |
|----------|----------------|
| `test_gurupass_rag.ipynb` | GuruPass — `match_municipio` |
| `evaluate_rag.ipynb` | Agregadores geral |
| `test_mercado_rag.ipynb` | Mercado |
| `test_regulatorio_lei_rag.ipynb` | Regulatório |
| `test_engenheiro_rag.ipynb` | Engenheiro |

Builders (regenerar `.ipynb`):

- `notebooks/_build_gurupass_eval_nb.py`
- `notebooks/_build_missing_eval_nbs.py`

```bash
python notebooks/_build_gurupass_eval_nb.py
```

## Fluxo eval GuruPass

1. Embed Ollama `mxbai-embed-large` @ 1024
2. RPC `match_chunks` com `match_municipio=expected_cidade`
3. Métricas: recall@k, precision@k, MRR, `city_match_rate`, `doc_match_rate`
4. Salvar: `data/evaluation/gurupass_eval_results.json`

## Variáveis comuns

```env
GURUPASS_GROUP_ID=4d1e2c40-217b-4a39-bc08-f9c3e90fd803
OLLAMA_BASE_URL=https://ollama2.vectracargo.com.br
EMBEDDING_MODEL=mxbai-embed-large
EMBEDDING_DIMENSION=1024
RAG_MIN_SIMILARITY=0.35
RAG_TOP_K=5
```

## Regras

- **Sempre** `SUPABASE_SERVICE_ROLE_KEY` nos notebooks (RPC `match_chunks` = service_role only)
- Não colar `'[...]'` como embedding no SQL — usar `embed_query()` no notebook
- `gurupass-normalized.json` = lista real; `gurupass-progress.json` = checkpoint (não é lista)
- Kernel Python do `.venv`, não MU Editor solto

## Troubleshooting

| Sintoma | Ação |
|---------|------|
| Porta em uso | matar PIDs 8888–8890 |
| RPC permission denied | service role, não anon |
| 0 hits | checar `embedding_model != pending`, `min_similarity` |
| `doc_match` baixo, `city_match` 1.0 | esperado — eval city-centric |
