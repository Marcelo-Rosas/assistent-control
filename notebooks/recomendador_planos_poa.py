"""
Recomendador de Planos por Academia — Piloto Porto Alegre
=========================================================
Consultoria comercial: identifica GAP de oferta de planos (tiers TotalPass) por
academia, comparando cada academia com seus PARES (mesma macro-modalidade + mesma
faixa de renda do bairro). Piloto POA (unico municipio com renda por bairro).

Metodo: peer-benchmark com backoff.
Entradas (todas read-only, ja no repo):
  data/raw/totalpass-brasil-all.json
  data/processed/tp-bairro-index.json         (gym_id -> bairro via reverse-geocode)
  data/geo/bairros/porto-alegre-rs.json        (bairro -> renda_media_sm)
  data/processed/recomendador-poa/modality_id_macro.csv (featured_modality_id -> macro)
Saidas: data/processed/recomendador-poa/*.csv + *.png

Rodar com o venv que tem pandas/matplotlib (scratchpad/totalpass/.venv).
"""
import json, os, csv
from collections import defaultdict, Counter
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

# ---- caminhos ----
REPO = r"C:\Users\marce\assistent-control"
OUT = os.path.join(REPO, "data", "processed", "recomendador-poa")
os.makedirs(OUT, exist_ok=True)

TIER_ORDER = ['plan_tp_free','plan_tp_free_indirects','plan_tp0','plan_tp1','plan_tp1_plus',
              'plan_tp2','plan_tp2_plus','plan_tp3','plan_tp4','plan_tp5','plan_tp5_plus',
              'plan_tp6','plan_tp7']
TIER_SHORT = {c: c.replace('plan_tp','TP').replace('_plus','+').replace('_free_indirects','Free-i').replace('_free','Free').upper()
              for c in TIER_ORDER}
# peso de negocio: tiers mais baratos = mais volume de alunos (maior valor comercial de fechar o gap)
TIER_WEIGHT = {c: 1.0 + max(0, (8 - i)) * 0.1 for i, c in enumerate(TIER_ORDER)}
MIN_PEERS = 15            # tamanho minimo do grupo de pares
OFFER_HIGH = 0.60        # pares oferecem >=60% -> gap se a academia nao oferece
OFFER_LOW = 0.15         # pares quase nao oferecem <15% -> possivel over-offering

# --- posicionamento (consciente de estrategia, tier data-driven do modelo nacional) ---
# Descer tier p/ captar volume e' jogo de low-cost/mid-market. P/ modalidade com
# tier de exclusividade nativa/propensa (modelo nacional), ofertar so' tier alto e'
# posicionamento DELIBERADO, nao gap. Substitui o antigo NICHE_MACROS hardcoded.
PREMIUM_ENTRY = {'plan_tp6', 'plan_tp7'}          # entra so' no topo
EXCLUSIVITY_TIERS = {'nativa', 'propensa'}        # tiers que legitimam TP7-only

def load_exclusivity_tiers():
    """tier de exclusividade por macro, do modelo nacional (modelo_exclusividade.py)."""
    path = os.path.join(OUT, 'modality_exclusivity_model.json')
    model = json.load(open(path, encoding='utf-8'))
    return {m: v['tier'] for m, v in model['modalidades'].items()}

EXCL_TIER = load_exclusivity_tiers()

# --- peso de tier por regiao (modelo de OFERTA/hab calibrado; peso_tier_regiao.py) ---
# ESCOPO: intensidade/nivel de OFERTA por bairro, validado LOO. NAO e' demanda de membro.
# Usa-se SO' o alvo 2 (entry_tier_medio_previsto ~ renda, R2=0.37, o forte) — a
# intensidade (alvo 1, R2=0.11) e' fraca demais p/ ponderar.
def load_region_weight():
    path = os.path.join(OUT, 'peso_tier_regiao_poa.json')
    if not os.path.exists(path):
        return {}, {}
    m = json.load(open(path, encoding='utf-8'))
    prev = {s: v['entry_tier_medio_previsto'] for s, v in m['peso_por_bairro'].items()}
    ptier = {s: v['P_tier'] for s, v in m['peso_por_bairro'].items()}
    return prev, ptier

REGION_ENTRY_PREV, REGION_PTIER = load_region_weight()

def classify_posicionamento(entry_tier, macro, renda_band):
    """premium_nicho se entra so' no topo E (modalidade exclusividade-nativa/propensa
    OU bairro renda alta). Modalidade de volume (ex.: Pilates) so' vira premium se
    estiver em bairro renda alta E entrar so' no topo (posicionamento individual)."""
    tier = EXCL_TIER.get(macro, 'volume')
    if entry_tier in PREMIUM_ENTRY and (tier in EXCLUSIVITY_TIERS or renda_band == 'alta'):
        return 'premium_nicho'
    return 'low_mid'

# aliases de bairro_slug -> slug do catalogo (nao resolvidos pelo match_slugs)
ALIAS_FIX = {'centro-historico': 'centro', 'passo-da-areia': 'passo-d-areia'}

# ---- carga ----
def load():
    tp = json.load(open(os.path.join(REPO,"data","raw","totalpass-brasil-all.json"), encoding='utf-8'))['data']
    idx = json.load(open(os.path.join(REPO,"data","processed","tp-bairro-index.json"), encoding='utf-8'))['by_gym_id']
    cat = json.load(open(os.path.join(REPO,"data","geo","bairros","porto-alegre-rs.json"), encoding='utf-8'))
    macro = {}
    with open(os.path.join(OUT,"modality_id_macro.csv"), encoding='utf-8') as f:
        for row in csv.DictReader(f):
            macro[str(row['id'])] = row['macro_grupo']
    return tp, idx, cat, macro

def build_bairro_maps(cat):
    slug2renda, slug2nome, alias2slug = {}, {}, {}
    for b in cat['bairros']:
        s = b['slug']
        slug2renda[s] = b.get('renda_media_sm')
        slug2nome[s] = b.get('bairro')
        alias2slug[s] = s
        for m in b.get('match_slugs', []):
            alias2slug[m] = s
    alias2slug.update(ALIAS_FIX)
    return slug2renda, slug2nome, alias2slug

def build_records(tp, idx, cat, macro):
    slug2renda, slug2nome, alias2slug = build_bairro_maps(cat)
    rows = []
    for g in tp:
        a = g['attributes']
        if 'Porto Alegre' not in (a.get('municipios_relacionados') or []):
            continue
        r = idx.get(g['id'])
        if not r or not r.get('bairro_slug'):
            continue
        bslug = alias2slug.get(r['bairro_slug'])
        if not bslug or slug2renda.get(bslug) is None:
            continue
        plans = [p for p in (a.get('accessible_on_plans') or []) if p.get('price') is not None]
        tiers = sorted({p['code'] for p in plans if p['code'] in TIER_ORDER}, key=TIER_ORDER.index)
        if not tiers:
            continue
        mid = str(a.get('featured_modality_id'))
        rows.append({
            'gym_id': g['id'], 'nome': a.get('name'),
            'bairro_slug': bslug, 'bairro': slug2nome[bslug],
            'renda_sm': slug2renda[bslug],
            'macro': macro.get(mid, 'Outros'),
            'tiers': tiers,
            'entry_tier': tiers[0],
            'n_tiers': len(tiers),
        })
    df = pd.DataFrame(rows)
    # renda_band por tercis dos bairros presentes
    q = df['renda_sm'].quantile([1/3, 2/3]).values
    def band(x):
        if x <= q[0]: return 'baixa'
        if x <= q[1]: return 'media'
        return 'alta'
    df['renda_band'] = df['renda_sm'].apply(band)
    return df, q

# ---- offer_rate por grupo com backoff ----
def offer_rate(df_group):
    n = len(df_group)
    rates = {}
    for t in TIER_ORDER:
        rates[t] = float(df_group['tiers'].apply(lambda s: t in s).mean())
    return rates, n

def peer_rates(df):
    """Retorna funcao(macro, band) -> (rates, n, nivel_backoff)."""
    by_mb = {k: v for k, v in df.groupby(['macro','renda_band'])}
    by_m = {k: v for k, v in df.groupby('macro')}
    by_b = {k: v for k, v in df.groupby('renda_band')}
    all_rates, all_n = offer_rate(df)
    def get(macro, band):
        g = by_mb.get((macro, band))
        if g is not None and len(g) >= MIN_PEERS:
            r, n = offer_rate(g); return r, n, 'macro×renda'
        g = by_m.get(macro)
        if g is not None and len(g) >= MIN_PEERS:
            r, n = offer_rate(g); return r, n, 'macro'
        g = by_b.get(band)
        if g is not None and len(g) >= MIN_PEERS:
            r, n = offer_rate(g); return r, n, 'renda'
        return all_rates, all_n, 'global'
    return get

# ---- gap por academia ----
def compute_gaps(df):
    get = peer_rates(df)
    recs = []
    for _, row in df.iterrows():
        rates, npeers, nivel = get(row['macro'], row['renda_band'])
        offered = set(row['tiers'])
        gaps = [(t, rates[t]) for t in TIER_ORDER
                if rates[t] >= OFFER_HIGH and t not in offered]
        over = [t for t in row['tiers'] if rates[t] < OFFER_LOW]
        score_total = sum(rate * TIER_WEIGHT[t] for t, rate in gaps)
        pos = classify_posicionamento(row['entry_tier'], row['macro'], row['renda_band'])
        # --- ancoragem regional (modelo de OFERTA calibrado, alvo 2) ---
        prev = REGION_ENTRY_PREV.get(row['bairro_slug'])          # tier de entrada MEDIO previsto p/ o bairro
        entry_idx = TIER_ORDER.index(row['entry_tier'])
        desvio_regional = round(entry_idx - prev, 2) if prev is not None else None  # + = entra acima do nivel regional
        ptier = REGION_PTIER.get(row['bairro_slug'], {})          # P(tier|bairro)
        # gap ponderado: gaps em tiers de alta prob. regional pesam mais (so' gaps reais)
        if pos == 'premium_nicho':
            gap_score_ponderado = 0.0
        else:
            gap_score_ponderado = round(sum(rate * TIER_WEIGHT[t] * ptier.get(TIER_SHORT[t], 0.0)
                                            for t, rate in gaps), 3)
        # Para premium/nicho, descer tier e' escolha de posicionamento, nao gap comercial.
        # O gap continua listado (transparencia), mas nao entra na prioridade (gap_score).
        if pos == 'premium_nicho':
            gap_class = 'estrategico_nao_gap'
            gap_score = 0.0                 # nao priorizar descer tier em premium
            gap_score_estrategico = round(score_total, 3)   # o que seria, p/ contraste
        else:
            gap_class = 'gap_real'
            gap_score = round(score_total, 3)
            gap_score_estrategico = round(score_total, 3)
        recs.append({
            'gym_id': row['gym_id'], 'nome': row['nome'],
            'bairro': row['bairro'], 'renda_sm': row['renda_sm'],
            'renda_band': row['renda_band'], 'macro': row['macro'],
            'tier_exclusividade': EXCL_TIER.get(row['macro'], 'volume'),
            'posicionamento': pos,
            'entry_tier': TIER_SHORT[row['entry_tier']],
            'tiers_ofertados': '|'.join(TIER_SHORT[t] for t in row['tiers']),
            'gap_tiers': '|'.join(TIER_SHORT[t] for t, _ in gaps),
            'n_gaps': len(gaps),
            'gap_class': gap_class,
            'over_offering': '|'.join(TIER_SHORT[t] for t in over),
            'gap_score': gap_score,
            'gap_score_estrategico': gap_score_estrategico,
            'entry_tier_regional_previsto': round(prev, 2) if prev is not None else None,
            'desvio_vs_regional': desvio_regional,
            'gap_score_ponderado': gap_score_ponderado,
            'peer_n': npeers, 'peer_backoff': nivel,
        })
    return pd.DataFrame(recs).sort_values('gap_score', ascending=False)

# ---- matrizes de correlacao ----
def offer_matrix(df, by):
    macros = sorted(df[by].unique())
    M = []
    for k in macros:
        g = df[df[by] == k]
        M.append([g['tiers'].apply(lambda s: t in s).mean() for t in TIER_ORDER])
    return pd.DataFrame(M, index=macros, columns=[TIER_SHORT[t] for t in TIER_ORDER])

def heatmap(mat, title, path):
    fig, ax = plt.subplots(figsize=(11, max(3, 0.5*len(mat)+1)), dpi=130)
    im = ax.imshow(mat.values, cmap='viridis', vmin=0, vmax=1, aspect='auto')
    ax.set_xticks(range(mat.shape[1])); ax.set_xticklabels(mat.columns, rotation=45, ha='right', fontsize=8)
    ax.set_yticks(range(mat.shape[0])); ax.set_yticklabels(mat.index, fontsize=8)
    for i in range(mat.shape[0]):
        for j in range(mat.shape[1]):
            v = mat.values[i, j]
            ax.text(j, i, f'{v:.2f}', ha='center', va='center', fontsize=6,
                    color='white' if v < 0.6 else 'black')
    plt.colorbar(im, label='offer_rate (fração de academias com o tier)')
    ax.set_title(title); plt.tight_layout(); plt.savefig(path); plt.close()

# ---- analise posicionamento: TP7-only vs oferece TP3-TP6 ----
def posicionamento_analysis(df):
    def has_low(tiers):
        return any(t in tiers for t in ['plan_tp3','plan_tp4','plan_tp5','plan_tp5_plus','plan_tp6'])
    A = df[df['tiers'].apply(lambda t: t == ['plan_tp7'])]           # exclusivo
    B = df[df['tiers'].apply(has_low)]                                # volume
    def prof(g, label):
        return {
            'grupo': label, 'n': len(g),
            'renda_sm_mediana': round(g['renda_sm'].median(), 2),
            'densidade_mediana': round(g['dens'].median(), 1) if 'dens' in g else None,
            'n_tiers_mediano': int(g['n_tiers'].median()),
            'macro_top3': ', '.join(f"{k}({v})" for k, v in g['macro'].value_counts().head(3).items()),
        }
    tab = pd.DataFrame([prof(A, 'TP7-only (exclusivo)'), prof(B, 'oferece TP3-TP6 (volume)')])
    # split intra-modalidade: mesma modalidade, posicionamento oposto -> prova de escolha
    splits = []
    for mm in ['Pilates & Fisio', 'EMS', 'Musculacao', 'Yoga']:
        sub = df[df['macro'] == mm]
        if len(sub) == 0:
            continue
        excl = sub[sub['entry_tier'] == 'plan_tp7']
        vol = sub[sub['entry_tier'].isin(['plan_tp0','plan_tp1','plan_tp1_plus','plan_tp2','plan_tp2_plus','plan_tp3'])]
        splits.append({
            'macro': mm, 'n': len(sub),
            'n_exclusivo_TP7entry': len(excl), 'renda_exclusivo': round(excl['renda_sm'].median(),1) if len(excl) else None,
            'n_volume_entryLow': len(vol), 'renda_volume': round(vol['renda_sm'].median(),1) if len(vol) else None,
        })
    return tab, pd.DataFrame(splits)

def posicionamento_scatter(gaps, df, path):
    m = df.set_index('gym_id')
    g = gaps.copy()
    g['entry_idx'] = g['gym_id'].map(lambda i: TIER_ORDER.index(m.loc[i,'entry_tier']))
    g['ntiers'] = g['gym_id'].map(lambda i: m.loc[i,'n_tiers'])
    fig, ax = plt.subplots(figsize=(10,6.5), dpi=130)
    for pos, color in [('low_mid','#4C6EF5'), ('premium_nicho','#E64980')]:
        s = g[g['posicionamento'] == pos]
        ax.scatter(s['renda_sm'], s['entry_idx'], s=s['ntiers']*18+10, alpha=.5,
                   color=color, edgecolor='white', linewidth=.5, label=pos)
    ax.set_yticks(range(len(TIER_ORDER))); ax.set_yticklabels([TIER_SHORT[t] for t in TIER_ORDER], fontsize=7)
    ax.set_xlabel('renda média do bairro (salários mínimos)'); ax.set_ylabel('tier de ENTRADA (menor plano que dá acesso)')
    ax.set_title('POA: posicionamento — tier de entrada × renda do bairro\n(tamanho = nº de tiers ofertados; rosa = premium/nicho exclusivo)')
    ax.legend(); ax.grid(alpha=.2); plt.tight_layout(); plt.savefig(path); plt.close()

# ---- main ----
def main():
    tp, idx, cat, macro = load()
    df, q = build_records(tp, idx, cat, macro)
    print(f"academias POA no dataset final: {len(df)}")
    print(f"tercis renda_sm: baixa<={q[0]:.2f}  media<={q[1]:.2f}  alta>")
    print("distribuicao renda_band:", dict(df['renda_band'].value_counts()))
    print("distribuicao macro (top):", dict(df['macro'].value_counts().head(8)))

    # tamanho dos grupos de pares
    sizes = df.groupby(['macro','renda_band']).size().sort_values(ascending=False)
    print(f"\ncelulas macro×renda: {len(sizes)} | com N>={MIN_PEERS}: {(sizes>=MIN_PEERS).sum()}")

    gaps = compute_gaps(df)
    gaps.to_csv(os.path.join(OUT,'gym_gap_recommendations_poa.csv'), index=False, encoding='utf-8')
    print(f"\ngaps: {(gaps['n_gaps']>0).sum()}/{len(gaps)} academias com gap listado")
    print("posicionamento:", dict(gaps['posicionamento'].value_counts()))
    print("gap_class:", dict(gaps['gap_class'].value_counts()))
    print("backoff usado:", dict(gaps['peer_backoff'].value_counts()))

    # --- refinamento: analise de posicionamento (TP7-only vs volume) ---
    tab, splits = posicionamento_analysis(df)
    tab.to_csv(os.path.join(OUT,'posicionamento_tp7_vs_volume_poa.csv'), index=False, encoding='utf-8')
    print("\n=== TP7-only (exclusivo) vs oferece TP3-TP6 (volume) ===")
    print(tab.to_string(index=False))
    print("\n=== split intra-modalidade (mesma modalidade, posicionamento oposto) ===")
    print(splits.to_string(index=False))
    posicionamento_scatter(gaps, df, os.path.join(OUT,'posicionamento_scatter.png'))

    # agregado por bairro
    bair = gaps.groupby('bairro').agg(
        n_academias=('gym_id','count'),
        renda_sm=('renda_sm','first'),
        gap_score_medio=('gap_score','mean'),
        pct_com_gap=('n_gaps', lambda s: (s>0).mean()),
    ).round(3).sort_values('gap_score_medio', ascending=False)
    bair.to_csv(os.path.join(OUT,'bairro_gap_summary_poa.csv'), encoding='utf-8')

    # matrizes
    mmod = offer_matrix(df, 'macro'); mmod.round(3).to_csv(os.path.join(OUT,'modality_tier_offer_poa.csv'))
    mren = offer_matrix(df, 'renda_band').reindex(['baixa','media','alta'])
    mren.round(3).to_csv(os.path.join(OUT,'renda_tier_offer_poa.csv'))
    heatmap(mmod, 'POA: offer_rate por modalidade × tier', os.path.join(OUT,'heatmap_modalidade_tier.png'))
    heatmap(mren, 'POA: offer_rate por faixa de renda × tier', os.path.join(OUT,'heatmap_renda_tier.png'))

    # ranking top bairros por gap
    top = bair.head(15)
    fig, ax = plt.subplots(figsize=(9,6), dpi=130)
    ax.barh(top.index[::-1], top['gap_score_medio'][::-1], color='#4C6EF5')
    ax.set_xlabel('gap_score médio'); ax.set_title('POA: bairros com maior gap de oferta de planos (top 15)')
    plt.tight_layout(); plt.savefig(os.path.join(OUT,'top_bairros_gap.png')); plt.close()

    print("\n=== TOP 8 gap REAL (low/mid — prioridade comercial) ===")
    real = gaps[gaps['gap_class']=='gap_real']
    print(real[['nome','bairro','renda_band','macro','tiers_ofertados','gap_tiers','gap_score']].head(8).to_string(index=False))
    print("\n=== TOP 6 'estrategico, nao gap' (premium/nicho — NAO recomendar descer) ===")
    estr = gaps[gaps['gap_class']=='estrategico_nao_gap'].sort_values('gap_score_estrategico', ascending=False)
    print(estr[['nome','bairro','renda_band','macro','tiers_ofertados','gap_tiers','gap_score_estrategico']].head(6).to_string(index=False))
    print(f"\nSaidas em: {OUT}")

if __name__ == '__main__':
    main()
