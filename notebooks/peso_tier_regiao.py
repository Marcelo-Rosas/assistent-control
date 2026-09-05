"""
Peso de tier por regiao — modelo de INTENSIDADE DE OFERTA, calibrado (POA)
=========================================================================
ESCOPO HONESTO: a base TP so' tem OFERTA (quais planos dao acesso a cada academia).
NAO ha' dado de membro/demanda. Populacao por bairro NAO calibra demanda de membro
— ela e' o DENOMINADOR de exposicao que torna um alvo OBSERVAVEL: intensidade de
oferta por habitante. Este modelo calibra e valida (LOO-CV) a OFERTA/hab. A ponte
oferta -> demanda de membro permanece NAO-VALIDADA e declarada.

Dois alvos observaveis (validados out-of-sample nos 94 bairros POA):
  1) academias por 1000 hab  ~ f(renda, densidade)
  2) entry_tier medio        ~ g(renda)              <- o "tier por regiao"
Peso P(tier|bairro): distribuicao centrada no entry_tier_medio PREVISTO (calibrado),
com dispersao = desvio intra-bairro observado (parametro documentado, nao calibrado).
"""
import json, os, csv
import numpy as np
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
from sklearn.linear_model import Ridge
from sklearn.model_selection import LeaveOneOut
from sklearn.metrics import mean_absolute_error, r2_score

R = r"C:\Users\marce\assistent-control"
OUT = os.path.join(R, "data", "processed", "recomendador-poa")
TO = ['plan_tp_free','plan_tp_free_indirects','plan_tp0','plan_tp1','plan_tp1_plus','plan_tp2',
      'plan_tp2_plus','plan_tp3','plan_tp4','plan_tp5','plan_tp5_plus','plan_tp6','plan_tp7']
SH = {c: c.replace('plan_tp','TP').replace('_plus','+').replace('_free_indirects','Fi').replace('_free','F').upper() for c in TO}

def load():
    tp = json.load(open(os.path.join(R,"data","raw","totalpass-brasil-all.json"), encoding='utf-8'))['data']
    idx = json.load(open(os.path.join(R,"data","processed","tp-bairro-index.json"), encoding='utf-8'))['by_gym_id']
    cat = json.load(open(os.path.join(R,"data","geo","bairros","porto-alegre-rs.json"), encoding='utf-8'))
    return tp, idx, cat

def main():
    tp, idx, cat = load()
    a2s = {b['slug']: b['slug'] for b in cat['bairros']}
    for b in cat['bairros']:
        for m in b.get('match_slugs', []): a2s[m] = b['slug']
    a2s['centro-historico'] = 'centro'; a2s['passo-da-areia'] = 'passo-d-areia'
    binfo = {b['slug']: b for b in cat['bairros']}

    # academias POA por bairro: contagem + lista de entry_tier_idx
    from collections import defaultdict
    gyms = defaultdict(list)
    for g in tp:
        a = g['attributes']
        if 'Porto Alegre' not in (a.get('municipios_relacionados') or []): continue
        r = idx.get(g['id'])
        if not r or not r.get('bairro_slug'): continue
        bs = a2s.get(r['bairro_slug'])
        if bs not in binfo: continue
        pl = [p for p in (a.get('accessible_on_plans') or []) if p.get('price') is not None]
        ti = sorted({p['code'] for p in pl if p['code'] in TO}, key=TO.index)
        if not ti: continue
        gyms[bs].append(TO.index(ti[0]))   # entry-tier index

    # dataset por bairro (94; 44 com zero academia sao observacoes validas de intensidade 0)
    rows = []
    for slug, b in binfo.items():
        pop = b['populacao_2022']; renda = b['renda_media_sm']; dens = b['densidade_hab_ha']
        entries = gyms.get(slug, [])
        n = len(entries)
        rows.append({
            'slug': slug, 'bairro': b['bairro'], 'pop': pop, 'renda': renda, 'dens': dens,
            'n_gyms': n,
            'intensidade_obs': n / (pop/1000) if pop else 0.0,   # academias por 1000 hab
            'entry_medio_obs': float(np.mean(entries)) if entries else np.nan,
            'entry_std_obs': float(np.std(entries)) if len(entries) >= 2 else np.nan,
        })

    # ---------- ALVO 1: intensidade/hab ~ f(renda, densidade) [todos 94, zeros incluidos] ----------
    X1 = np.array([[r['renda'], r['dens']] for r in rows])
    y1 = np.array([r['intensidade_obs'] for r in rows])
    X1n = (X1 - X1.mean(0)) / X1.std(0)
    loo = LeaveOneOut(); pred1 = np.zeros_like(y1)
    for tr, te in loo.split(X1n):
        m = Ridge(alpha=1.0).fit(X1n[tr], y1[tr]); pred1[te] = m.predict(X1n[te])
    mae1 = mean_absolute_error(y1, pred1); r2_1 = r2_score(y1, pred1)
    print(f"ALVO 1 (intensidade academias/1000hab, n=94, zeros incl.): LOO MAE={mae1:.3f} R2={r2_1:.3f}")

    # ---------- ALVO 2: entry_tier medio ~ g(renda) [so' bairros com academia] ----------
    hav = [r for r in rows if not np.isnan(r['entry_medio_obs'])]
    X2 = np.array([[r['renda']] for r in hav]); y2 = np.array([r['entry_medio_obs'] for r in hav])
    X2n = (X2 - X2.mean(0)) / X2.std(0)
    pred2 = np.zeros_like(y2)
    for tr, te in loo.split(X2n):
        m = Ridge(alpha=1.0).fit(X2n[tr], y2[tr]); pred2[te] = m.predict(X2n[te])
    mae2 = mean_absolute_error(y2, pred2); r2_2 = r2_score(y2, pred2)
    # baseline: prever sempre a media (R2=0 por construcao) -> compara
    print(f"ALVO 2 (entry_tier medio ~ renda, n={len(hav)}): LOO MAE={mae2:.3f} tiers  R2={r2_2:.3f}")
    print(f"   (MAE em 'passos de tier'; baseline media MAE={mean_absolute_error(y2, np.full_like(y2, y2.mean())):.3f})")

    # modelo final alvo 2 (fit em todos os com-academia) para prever entry_medio de TODObairro
    mfin = Ridge(alpha=1.0).fit(X2n, y2)
    disp = float(np.nanmean([r['entry_std_obs'] for r in rows if not np.isnan(r['entry_std_obs'])]))  # dispersao tipica intra-bairro
    print(f"   dispersao intra-bairro tipica (entry_std) = {disp:.2f} tiers (parametro do spread, NAO calibrado)")

    # ---------- Peso P(tier|bairro): centrado no entry_medio previsto, spread=disp ----------
    def dist_tier(center, spread):
        idxs = np.arange(len(TO))
        w = np.exp(-0.5 * ((idxs - center) / max(spread, 0.5))**2)
        return w / w.sum()
    rmean = X2.mean(0); rstd = X2.std(0)
    # modelo final alvo 1 (intensidade) para previsao por bairro
    m1fin = Ridge(alpha=1.0).fit(X1n, y1); X1mean = X1.mean(0); X1std = X1.std(0)
    peso = {}
    for r in rows:
        c = float(mfin.predict(((np.array([[r['renda']]]) - rmean) / rstd))[0])
        c = min(max(c, 0), len(TO)-1)
        inten = float(m1fin.predict(((np.array([[r['renda'], r['dens']]]) - X1mean) / X1std))[0])
        p = dist_tier(c, disp)
        peso[r['slug']] = {'bairro': r['bairro'], 'renda': r['renda'], 'pop': r['pop'],
                           'intensidade_prevista_por_1000hab': round(max(inten, 0.0), 3),
                           'entry_tier_medio_previsto': round(c, 2),
                           'entry_tier_medio_previsto_label': SH[TO[int(round(c))]],
                           'P_tier': {SH[TO[i]]: round(float(p[i]), 4) for i in range(len(TO))}}

    model = {
        'version': '1',
        'escopo': 'INTENSIDADE DE OFERTA por habitante (observavel). NAO e demanda de membro. Ponte oferta->demanda NAO validada.',
        'base': 'Porto Alegre — 94 bairros (50 com academia, 44 com zero)',
        'sparsity': {'bairros_total': 94, 'bairros_com_academia': len(gyms), 'academias_total': sum(len(v) for v in gyms.values())},
        'calibracao_LOO': {
            'alvo1_intensidade_por_1000hab': {'MAE': round(mae1,4), 'R2': round(r2_1,4), 'n': 94, 'features': ['renda','densidade']},
            'alvo2_entry_tier_medio': {'MAE_em_passos_de_tier': round(mae2,4), 'R2': round(r2_2,4), 'n': len(hav), 'features': ['renda']},
        },
        'spread_param': {'dispersao_intra_bairro_tiers': round(disp,3), 'nota': 'nao calibrado; desvio-padrao intra-bairro observado'},
        'peso_por_bairro': peso,
    }
    with open(os.path.join(OUT,'peso_tier_regiao_poa.json'),'w',encoding='utf-8') as f:
        json.dump(model, f, ensure_ascii=False, indent=2)

    # ---------- charts: previsto vs observado (calibracao) ----------
    fig, axs = plt.subplots(1, 2, figsize=(13,5.5), dpi=130)
    axs[0].scatter(y1, pred1, s=20, alpha=.6, color='#4C6EF5')
    lim=[min(y1.min(),pred1.min()), max(y1.max(),pred1.max())]; axs[0].plot(lim,lim,'--',color='gray')
    axs[0].set_xlabel('observado'); axs[0].set_ylabel('previsto (out-of-sample)')
    axs[0].set_title(f'Alvo 1: intensidade academias/1000hab\nLOO MAE={mae1:.2f}  R2={r2_1:.2f}  (n=94)')
    axs[1].scatter(y2, pred2, s=20, alpha=.6, color='#12B886')
    lim=[min(y2.min(),pred2.min()), max(y2.max(),pred2.max())]; axs[1].plot(lim,lim,'--',color='gray')
    axs[1].set_xlabel('entry_tier medio observado'); axs[1].set_ylabel('previsto (out-of-sample)')
    axs[1].set_title(f'Alvo 2: entry_tier medio ~ renda\nLOO MAE={mae2:.2f} tiers  R2={r2_2:.2f}  (n={len(hav)})')
    fig.suptitle('Calibracao out-of-sample (LOO-CV) — modelo de OFERTA/hab, NAO demanda de membro', fontsize=12)
    plt.tight_layout(); plt.savefig(os.path.join(OUT,'peso_tier_regiao_calibracao.png')); plt.close()

    print(f"\nSaidas: peso_tier_regiao_poa.json, peso_tier_regiao_calibracao.png em {OUT}")
    print("ROTULO: modelo de INTENSIDADE DE OFERTA/hab (observavel, validado). NAO e demanda de membro.")

if __name__ == '__main__':
    main()
