"""Baixa os modelos de voz pt-BR do Piper para data/tts/piper/.

Os modelos pesam ~60 MB cada e ficam fora do git (ver .gitignore), entao um
clone novo comeca sem voz local e cai na Web Speech API. Este script repoe.

    python scripts/setup_tts.py            # so a voz padrao (faber)
    python scripts/setup_tts.py --todas    # as tres masculinas pt-BR
    python scripts/setup_tts.py --voz cadu

Depois: pip install piper-tts
"""
from __future__ import annotations

import argparse
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "data" / "tts" / "piper"
BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR"

# Vozes masculinas pt-BR de qualidade `medium`. `edresson` existe, mas so em
# `low` — descartada por qualidade.
VOZES = ("faber", "cadu", "jeff")
PADRAO = "faber"


def baixar(voz: str) -> bool:
    DEST.mkdir(parents=True, exist_ok=True)
    ok = True
    for ext in ("onnx", "onnx.json"):
        nome = f"pt_BR-{voz}-medium.{ext}"
        alvo = DEST / nome
        if alvo.exists() and alvo.stat().st_size > 0:
            print(f"  ja existe: {nome}")
            continue
        url = f"{BASE}/{voz}/medium/{nome}"
        print(f"  baixando {nome} ...", flush=True)
        try:
            urllib.request.urlretrieve(url, alvo)
        except (urllib.error.URLError, OSError) as exc:
            print(f"  FALHOU {nome}: {exc}", file=sys.stderr)
            # Arquivo truncado enganaria o loader depois; melhor remover.
            alvo.unlink(missing_ok=True)
            ok = False
    return ok


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--voz", choices=VOZES, help="baixa apenas esta voz")
    ap.add_argument("--todas", action="store_true", help="baixa as tres vozes")
    args = ap.parse_args()

    alvos = VOZES if args.todas else (args.voz or PADRAO,)
    falhas = [v for v in alvos if (print(f"{v}:") or not baixar(v))]

    if falhas:
        print(f"\nfalhas: {', '.join(falhas)}", file=sys.stderr)
        return 1
    print(f"\npronto em {DEST}")
    print("falta o pacote? pip install piper-tts")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
