"""
Modelo de Exclusividade por Modalidade — base NACIONAL (TotalPass Brasil)
========================================================================
Grava, por macro-modalidade, a PROPENSAO a exclusividade = fracao das academias
da modalidade que sao TP7-only (entram so' no topo). Deriva um TIER data-driven:
  nativa   : propensao >= 50%          (exclusividade estrutural)
  propensa : lift >= 3x da taxa-base   (minoria exclusiva relevante)
  volume   : resto                     (TP7-only e' excecao individual)

Corrige a premissa POA (n=22): nacionalmente Pilates e' VOLUME (2,4%), nao nicho.
Saidas: data/processed/recomendador-poa/modality_exclusivity_model.json + .png
"""
import json, os, csv
from collections import Counter
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

REPO = r"C:\Users\marce\assistent-control"
OUT = os.path.join(REPO, "data", "processed", "recomendador-poa")
os.makedirs(OUT, exist_ok=True)

TIER_ORDER = ['plan_tp_free','plan_tp_free_indirects','plan_tp0','plan_tp1','plan_tp1_plus',
              'plan_tp2','plan_tp2_plus','plan_tp3','plan_tp4','plan_tp5','plan_tp5_plus',
              'plan_tp6','plan_tp7']
NATIVA_MIN = 0.50    # propensao >= 50% -> nativa
PROPENSA_LIFT = 3.0  # lift >= 3x -> propensa
MIN_N = 30           # so' classifica modalidade com base amostral suficiente

def load_macro():
    macro = {}
    with open(os.path.join(OUT,"modality_id_macro.csv"), encoding='utf-8') as f:
        for row in csv.DictReader(f):
            macro[str(row['id'])] = row['macro_grupo']
    return macro

def main():
    tp = json.load(open(os.path.join(REPO,"data","raw","totalpass-brasil-all.json"), encoding='utf-8'))['data']
    macro = load_macro()
    tot = Counter(); tp7 = Counter()
    for g in tp:
        a = g['attributes']
        plans = [p for p in (a.get('accessible_on_plans') or []) if p.get('price') is not None]
        tiers = sorted({p['code'] for p in plans if p['code'] in TIER_ORDER}, key=TIER_ORDER.index)
        if not tiers:
            continue
        m = macro.get(str(a.get('featured_modality_id')), 'Outros')
        tot[m] += 1
        if tiers == ['plan_tp7']:
            tp7[m] += 1
    N = sum(tot.values()); base_rate = sum(tp7.values()) / N
    print(f"base nacional: {N} | TP7-only: {sum(tp7.values())} ({base_rate*100:.2f}%)  taxa-base\n")

    model = {'version': '1', 'base': 'totalpass-brasil-all (nacional)', 'n_total': N,
             'base_rate_tp7only': round(base_rate, 5),
             'thresholds': {'nativa_min_propensao': NATIVA_MIN, 'propensa_min_lift': PROPENSA_LIFT, 'min_n': MIN_N},
             'modalidades': {}}
    rows = []
    for m in sorted(tot, key=lambda k: -(tp7[k]/tot[k] if tot[k] else 0)):
        n = tot[m]; ex = tp7[m]; prop = ex/n if n else 0.0; lift = prop/base_rate if base_rate else 0.0
        if n < MIN_N:
            tier = 'indefinido'
        elif prop >= NATIVA_MIN:
            tier = 'nativa'
        elif lift >= PROPENSA_LIFT:
            tier = 'propensa'
        else:
            tier = 'volume'
        model['modalidades'][m] = {'n_total': n, 'n_tp7only': ex, 'propensao': round(prop,4),
                                   'lift': round(lift,2), 'tier': tier}
        rows.append((m, n, ex, prop, lift, tier))

    with open(os.path.join(OUT,'modality_exclusivity_model.json'),'w',encoding='utf-8') as f:
        json.dump(model, f, ensure_ascii=False, indent=2)

    print(f"{'modalidade':18s} {'n':>6} {'tp7only':>8} {'propensao':>10} {'lift':>6}  tier")
    for m,n,ex,prop,lift,tier in rows:
        print(f"{m:18s} {n:6d} {ex:8d} {prop*100:9.1f}% {lift:5.1f}x  {tier}")
    print("\ntiers:", {t: [m for m,_,_,_,_,tt in rows if tt==t] for t in ['nativa','propensa','volume']})

    # grafico
    plot = [(m,prop,tier) for m,n,ex,prop,lift,tier in rows if tier != 'indefinido']
    plot.sort(key=lambda x: -x[1])
    cores = {'nativa':'#E64980','propensa':'#F59F00','volume':'#4C6EF5'}
    fig, ax = plt.subplots(figsize=(11,6), dpi=130)
    ax.bar([p[0] for p in plot], [p[1]*100 for p in plot], color=[cores[p[2]] for p in plot])
    ax.axhline(NATIVA_MIN*100, ls='--', color='#E64980', lw=1, label=f'corte nativa ({int(NATIVA_MIN*100)}%)')
    ax.axhline(base_rate*PROPENSA_LIFT*100, ls='--', color='#F59F00', lw=1, label=f'corte propensa (lift {PROPENSA_LIFT:.0f}× = {base_rate*PROPENSA_LIFT*100:.1f}%)')
    ax.set_ylabel('propensão a TP7-only (% da modalidade)')
    ax.set_title('Modelo de exclusividade — propensão a TP7-only por modalidade (base nacional)')
    plt.xticks(rotation=45, ha='right', fontsize=8); ax.legend(); plt.tight_layout()
    plt.savefig(os.path.join(OUT,'exclusividade_propensao.png')); plt.close()
    print(f"\nSaidas: modality_exclusivity_model.json, exclusividade_propensao.png em {OUT}")

if __name__ == '__main__':
    main()
