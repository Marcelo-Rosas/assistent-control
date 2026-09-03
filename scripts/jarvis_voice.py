"""Voz do JARVIS-Q — registro de fala PT-BR e normalizacao para TTS.

Duas responsabilidades separadas de proposito:

1. REGISTRO (`tratar`, `abrir`, `fechar`): o tom. Mordomo britanico vertido pro
   portugues — cortes, contido, economico. Trata por "senhor", mas com
   parcimonia: JARVIS nao repete "sir" a cada frase, usa em abertura ou
   fechamento. Repetir vira bajulacao e cansa em voz alta.

2. FALA (`to_speech`): o texto EXIBIDO nem sempre e o texto FALADO. Sigla e
   termo tecnico escrito ("t-SNE", "HParams", "KG") sai pessimo num TTS
   pt-BR, que tenta ler como palavra. Aqui viram grafia fonetica.

O campo `resposta` do AskResult continua sendo o texto de tela; `fala` (aditivo)
carrega a versao normalizada. Consumidor antigo que ignore `fala` segue
funcionando.
"""
from __future__ import annotations

import re

# Tratamento. Trocar para "" desliga o vocativo em todo o sistema sem tocar
# nas strings de resposta uma a uma.
TRATAMENTO = "senhor"


def tratar(texto: str) -> str:
    """Aplica o vocativo nos marcadores {sr} deixados nas respostas."""
    if not TRATAMENTO:
        # Sem tratamento: remove o marcador e a virgula orfa que sobraria.
        out = re.sub(r",?\s*\{sr\}", "", texto)
        return re.sub(r"\s{2,}", " ", out).strip()
    return texto.replace("{sr}", TRATAMENTO)


# Grafias faladas. Chave = como aparece no texto; valor = como o TTS deve ler.
# So entra aqui o que o sintetizador pt-BR erra de fato — nao e glossario.
_FALA: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bt-SNE\b", re.I), "tê-ésse-ené"),
    (re.compile(r"\bPR Curves\b", re.I), "pê-érre curves"),
    (re.compile(r"\bHParams\b", re.I), "agá-params"),
    (re.compile(r"\bKG\b"), "grafo de conhecimento"),
    (re.compile(r"\bTensorBoard\b", re.I), "tensorbórd"),
    (re.compile(r"\bTotalPass\b", re.I), "tótalpass"),
    (re.compile(r"\bWellhub\b", re.I), "uélhab"),
    (re.compile(r"\bGurupass\b", re.I), "gurupass"),
    (re.compile(r"\bIBGE\b"), "i-bê-gê-é"),
    (re.compile(r"\bCEP\b"), "cépe"),
    (re.compile(r"\bCNPJ\b"), "cê-ene-pê-jóta"),
    (re.compile(r"\bMRLR\b"), "eme-érre-ele-érre"),
    (re.compile(r"\bTF\b"), "tensorflow"),
    (re.compile(r"\bELI5\b", re.I), "explicação simples"),
    (re.compile(r"\bR-GCN\b", re.I), "érre-gê-cê-ene"),
    # "3D" isolado sai "três dê" em alguns engines; "três dimensões" e seguro.
    (re.compile(r"\b3D\b", re.I), "três dimensões"),
]

# Reticencias e travessao viram pausa real; o engine ignora os glifos.
_PAUSA = [
    (re.compile(r"\s*—\s*"), ", "),
    (re.compile(r"\s*…\s*"), ". "),
    (re.compile(r"\s*\.\.\.\s*"), ". "),
]


def to_speech(texto: str) -> str:
    """Converte o texto de tela na versao que o TTS deve pronunciar."""
    out = texto or ""
    for pat, repl in _FALA:
        out = pat.sub(repl, out)
    for pat, repl in _PAUSA:
        out = pat.sub(repl, out)
    # Numero decimal: "0.72" -> "0 vírgula 72" (o engine pt-BR le ponto como
    # separador de milhar e engole a fracao).
    out = re.sub(r"(\d+)\.(\d+)", r"\1 vírgula \2", out)
    return re.sub(r"\s{2,}", " ", out).strip()
