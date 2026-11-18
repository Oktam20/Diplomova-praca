#!/usr/bin/env bash

set -uo pipefail
cd "$(dirname "$0")"

CAST="${1:-vsetko}"
PYTHON="${PYTHON:-python}"
BEH="behy/$(date +%Y-%m-%d_%H-%M-%S)"
LOG="$BEH/beh.log"
MASKY="$BEH/masky"
export PYTHONUTF8=1 PYTHONIOENCODING=utf-8 MPLBACKEND=Agg

mkdir -p "$BEH"
SUHRN=()

zapis() {
  echo "$@" | tee -a "$LOG"
}

trvanie() {
  printf '%d min %02d s' $(($1 / 60)) $(($1 % 60))
}

zhrnutie() {
  zapis ""
  zapis "=================================================================="
  zapis "SÚHRN  ($(date '+%Y-%m-%d %H:%M:%S'), spolu $(trvanie $SECONDS))"
  zapis "=================================================================="
  for riadok in "${SUHRN[@]}"; do
    zapis "$riadok"
  done
  zapis ""
  zapis "Výsledky: analyzy/$BEH/"
}

krok() {
  local nazov="$1"
  shift
  local zaciatok=$SECONDS
  zapis ""
  zapis "=================================================================="
  zapis "$nazov"
  zapis "  príkaz:   $PYTHON -m $*"
  zapis "  začiatok: $(date '+%H:%M:%S')"
  zapis "------------------------------------------------------------------"
  "$PYTHON" -u -m "$@" 2>&1 | tee "$BEH/.vystup_kroku"
  local stav=${PIPESTATUS[0]}
  sed 's/.*\r//' "$BEH/.vystup_kroku" >> "$LOG"
  rm -f "$BEH/.vystup_kroku"
  local cas
  cas=$(trvanie $((SECONDS - zaciatok)))
  zapis "------------------------------------------------------------------"
  if ((stav == 0)); then
    zapis "  hotovo za $cas"
    SUHRN+=("$(printf '  %-34s OK      %s' "$nazov" "$cas")")
  else
    zapis "  CHYBA (kód $stav) po $cas – ďalšie kroky sa nespustia"
    SUHRN+=("$(printf '  %-34s CHYBA   %s' "$nazov" "$cas")")
    zhrnutie
    exit "$stav"
  fi
}

zapis "Spracovanie analýz – $(date '+%Y-%m-%d %H:%M:%S')"
zapis "  časť:     $CAST"
zapis "  kód:      $(git rev-parse --short HEAD 2>/dev/null || echo '?')$( [ -n "$(git status --porcelain . 2>/dev/null)" ] && echo ' + necommitnuté zmeny')"
zapis "  python:   $("$PYTHON" -c 'import sys, numpy, cv2, skimage; print(sys.version.split()[0], "| numpy", numpy.__version__, "| opencv", cv2.__version__, "| scikit-image", skimage.__version__)')"
zapis "  výstupy:  analyzy/$BEH/"

if [[ "$CAST" == "vsetko" || "$CAST" == "skvrny" ]]; then
  krok "1.1 Masky škvŕn" skvrny.vytvor_masky images/D2 --vystup "$MASKY"
  krok "1.2 Rozdelenie train / test" skvrny.rozdelenie images/D2 --vystup "$BEH/skvrny"
  krok "1.3 Vyhodnotenie voči ručným maskám" skvrny.vyhodnotenie --masky "$MASKY" --rucne images/D2masks \
    --fotky images/D2 --vystup "$BEH/skvrny"
  krok "1.4 Výber kanálov a metód" skvrny.vyber_kanalov --fotky images/D2 --rucne images/D2masks \
    --vystup "$BEH/skvrny"
fi

if [[ "$CAST" == "vsetko" || "$CAST" == "dokumenty" ]]; then
  [[ -d "$MASKY" ]] || MASKY="images/D2/masky"
  krok "2.1 Testovacie strany" dokumenty.generuj_strany --fotky images/D2 --masky images/D2masks \
    --vystup "$BEH/testovacie_strany"
  krok "2.2 Hľadanie škvŕn na stranách" dokumenty.dokument "$BEH/testovacie_strany" --vystup "$BEH/dokumenty"
  krok "2.3 Syntetický test" dokumenty.test_dokumenty --fotky images/D2 --masky "$MASKY" \
    --strany "$BEH"/testovacie_strany/prazdne/*.png --vystup "$BEH/dokumenty_test"
fi

if [[ "$CAST" == "vsetko" || "$CAST" == "klasifikacia" ]]; then
  [[ -d "$MASKY" ]] || MASKY="images/D2/masky"
  krok "3.1 Určovací kľúč (train / test)" klasifikacia.postav_kluc --fotky images/D2 --masky "$MASKY" \
    --vystup "$BEH/klasifikacia"
  krok "3.2 PCA farieb pixelov škvrny" klasifikacia.pca_farieb --fotky images/D2 --masky "$MASKY" \
    --rucne images/D2masks --vystup "$BEH/klasifikacia_pca"
  krok "3.3 Výber jadra škvrny" klasifikacia.vyber_jadra --fotky images/D2 --masky "$MASKY" \
    --rucne images/D2masks --vystup "$BEH/klasifikacia_jadro"
fi

zhrnutie
