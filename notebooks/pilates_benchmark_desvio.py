"""
Pilates — desvio de benchmark de tier (base TotalPass, SOMENTE oferta)
=====================================================================
Escopo honesto: a base TP so' tem dados de OFERTA (quais planos dao acesso a
cada academia). NAO ha dado de MEMBRO/DEMANDA (quantos membros, qual tier, onde
moram). Logo NAO se afirma nada sobre captacao de membros.

Afirmacao defensavel: uma academia que entra so' no topo (TP6/TP7) enquanto o
benchmark de pares (mesma modalidade) entra em TP3/TP4 esta' DESVIADA do padrao
de oferta. Isso pode ser posicionamento premium OU preco descolado do padrao —
os dados nao distinguem os dois; renda_sm do BAIRRO (nao do membro) e' so' um
contexto geografico, nao prova de demanda.

Saidas: data/processed/recomendador-poa/pilates_benchmark_desvio_poa.csv + PNG
"""
import json, os, csv, statistics as st
from collections import Counter
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt

R = r"C:\Users\marce\assistent-control"
OUT = os.path.join(R, "data", "processed", "recomendador-poa")
TO = ['plan_tp_free','plan_tp_free_indirects','plan_tp0','plan_tp1','plan_tp1_plus','plan_tp2',
      'plan_tp2_plus','plan_tp3','plan_tp4','plan_tp5','plan_tp5_plus','plan_tp6','plan_tp7']
SH = {c: c.replace('plan_tp','TP').replace('_plus','+').replace('_free_indirects','Fi').replace('_free','F').upper() for c in TO}

def load():
    tp = json.load(open(os.path.join(R,"data","raw","totalpass-brasil-all.json"), encoding='utf-8'))['data']
    idx = json.load(open(os.path.join(R,"data","processed","tp-bairro-index.json"), encoding='utf-8'))['by_gym_id']
    cat = json.load(open(os.path.join(R,"data","geo","bairros","porto-alegre-rs.json"), encoding='utf-8'))
    macro = {str(r['id']): r['macro_grupo'] for r in csv.DictReader(open(os.path.join(OUT,"modality_id_macro.csv"), encoding='utf-8'))}
    return tp, idx, cat, macro

def main():
    tp, idx, cat, macro = load()
    slug2r = {b['slug']: b.get('renda_media_sm') for b in cat['bairros']}
    slug2n = {b['slug']: b['bairro'] for b in cat['bairros']}
    a2s = {b['slug']: b['slug'] for b in cat['bairros']}
    for b in cat['bairros']:
        for m in b.get('match_slugs', []): a2s[m] = b['slug']
    a2s['centro-historico'] = 'centro'; a2s['passo-da-areia'] = 'passo-d-areia'

    # benchmark NACIONAL de entry-tier para Pilates (o padrao de oferta da modalidade)
    nac = []
    for g in tp:
        a = g['attributes']
        if macro.get(str(a.get('featured_modality_id'))) != 'Pilates & Fisio': continue
        pl = [p for p in (a.get('accessible_on_plans') or []) if p.get('price') is not None]
        ti = sorted({p['code'] for p in pl if p['code'] in TO}, key=TO.index)
        if ti: nac.append(TO.index(ti[0]))
    bench_mediana = int(st.median(nac))   # tier de entrada mediano nacional = benchmark
    print(f"Pilates nacional n={len(nac)} | entry-tier MEDIANO (benchmark) = {SH[TO[bench_mediana]]}")

    # POA Pilates: desvio vs benchmark
    poa = []
    for g in tp:
        a = g['attributes']
        if macro.get(str(a.get('featured_modality_id'))) != 'Pilates & Fisio': continue
        if 'Porto Alegre' not in (a.get('municipios_relacionados') or []): continue
        r = idx.get(g['id'])
        if not r or not r.get('bairro_slug'): continue
        bs = a2s.get(r['bairro_slug'])
        if not bs or slug2r.get(bs) is None: continue
        pl = [p for p in (a.get('accessible_on_plans') or []) if p.get('price') is not None]
        ti = sorted({p['code'] for p in pl if p['code'] in TO}, key=TO.index)
        if not ti: continue
        entry_idx = TO.index(ti[0])
        poa.append({
            'nome': a.get('name'), 'bairro': slug2n[bs], 'renda_sm': slug2r[bs],
            'entry_tier': SH[ti[0]], 'entry_idx': entry_idx, 'n_tiers': len(ti),
            'desvio_vs_benchmark': entry_idx - bench_mediana,   # + = entra mais acima (mais caro) que o padrao
        })
    poa.sort(key=lambda x: -x['desvio_vs_benchmark'])

    # rotulo honesto (SO' sobre oferta): so'-topo = entra em TP6/TP7
    for p in poa:
        if p['entry_idx'] >= TO.index('plan_tp6'):
            p['status_oferta'] = 'so_topo_desviado'   # entra so' no topo, acima do benchmark
        elif p['desvio_vs_benchmark'] >= 2:
            p['status_oferta'] = 'acima_do_benchmark'
        else:
            p['status_oferta'] = 'no_padrao'

    with open(os.path.join(OUT,'pilates_benchmark_desvio_poa.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=['nome','bairro','renda_sm','entry_tier','n_tiers','desvio_vs_benchmark','status_oferta'])
        w.writeheader()
        for p in poa: w.writerow({k: p[k] for k in w.fieldnames})

    print("distribuicao status_oferta:", dict(Counter(p['status_oferta'] for p in poa)))
    print("\n=== SO' TOPO / DESVIADO do benchmark (apenas OFERTA; NAO conclui sobre demanda) ===")
    for p in [p for p in poa if p['status_oferta']=='so_topo_desviado']:
        print(f"  {p['renda_sm']:5.1f}sm bairro | {p['entry_tier']:4s} | desvio +{p['desvio_vs_benchmark']} | {p['nome'][:38]} — {p['bairro']}")

    # chart: entry x renda, cor = status (rotulo de oferta, sem claim de demanda)
    cor = {'so_topo_desviado':'#E64980','acima_do_benchmark':'#F59F00','no_padrao':'#4C6EF5'}
    fig, ax = plt.subplots(figsize=(10,6), dpi=130)
    for p in poa:
        ax.scatter(p['renda_sm'], p['entry_idx'], s=60, alpha=.6, color=cor[p['status_oferta']], edgecolor='white', lw=.5)
    ax.axhline(bench_mediana, ls='--', color='gray', lw=1, label=f'benchmark nacional (entry mediano = {SH[TO[bench_mediana]]})')
    ax.set_yticks(range(len(TO))); ax.set_yticklabels([SH[t] for t in TO], fontsize=7)
    ax.set_xlabel('renda_sm do BAIRRO da academia (contexto geográfico — NÃO é renda de membro)')
    ax.set_ylabel('tier de ENTRADA (oferta)')
    ax.set_title('Pilates POA: desvio de benchmark de OFERTA\nrosa = só-topo acima do benchmark | escopo: só oferta, sem dado de demanda/membro')
    ax.legend(fontsize=8); plt.tight_layout()
    plt.savefig(os.path.join(OUT,'pilates_benchmark_desvio_poa.png')); plt.close()
    print(f"\nSaidas: pilates_benchmark_desvio_poa.csv, pilates_benchmark_desvio_poa.png")

if __name__ == '__main__':
    main()
