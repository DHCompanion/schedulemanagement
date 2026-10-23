#!/usr/bin/env bash
# One-off: batch-convert .mpp files to MSPDI XML with MPXJ, inside a Java container
# (no local Java needed). Resumable — files already converted are skipped.
# Throwaway backfill tooling; delete after the historical backfill (plan Phase 6).
#
#   scripts/convert-mpp.sh <source-dir> <out-dir>
set -euo pipefail

SRC=$(realpath "$1")
OUT=$(realpath -m "$2")
MPXJ_VERSION=16.10.0
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/sgc-mpxj/$MPXJ_VERSION"

if [ ! -f "$CACHE/lib/mpxj.jar" ]; then
  # The PyPI wheel bundles mpxj.jar plus every dependency jar — simplest single download.
  mkdir -p "$CACHE/dl"
  pip download --no-deps "mpxj==$MPXJ_VERSION" -d "$CACHE/dl" -q
  python3 -m zipfile -e "$CACHE"/dl/mpxj-*.whl "$CACHE/dl/x"
  mv "$(dirname "$(find "$CACHE/dl/x" -name mpxj.jar)")" "$CACHE/lib"
  rm -rf "$CACHE/dl"
fi

mkdir -p "$OUT"
# One container for the whole batch; a JVM per file is slow but keeps a bad file
# from taking down the rest. Failures are listed in $OUT/_failed.txt.
docker run --rm --network none -u "$(id -u):$(id -g)" \
  -v "$CACHE/lib":/mpxj:ro -v "$SRC":/src:ro -v "$OUT":/out \
  eclipse-temurin:21-jre bash -c '
    cd /src
    : > /out/_failed.txt
    find . -type f -iname "*.mpp" -print0 | while IFS= read -r -d "" f; do
      out="/out/${f%.*}.xml"
      [ -s "$out" ] && continue
      mkdir -p "$(dirname "$out")"
      if ! java -cp "/mpxj/*" org.mpxj.sample.MpxjConvert "$f" "$out" > /dev/null 2>&1; then
        rm -f "$out"; echo "$f" >> /out/_failed.txt
      fi
    done
    echo "converted: $(find /out -name "*.xml" | wc -l), failed: $(wc -l < /out/_failed.txt)"
  '
