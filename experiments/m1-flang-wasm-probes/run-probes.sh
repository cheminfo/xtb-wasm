#!/bin/bash
# Reusable probe runner. Reproduces every Milestone-1 measurement.
# Usage: bash run-probes.sh   (from a host that has the xtb-wasm/flang-wasm:m1 image)
SCRATCH=/private/tmp/claude-501/-Users-lpatiny-git-cheminfo-xtb-wasm/b4ef164a-9f01-47f3-82e3-bd6e64466d17/scratchpad
docker run --rm --platform linux/amd64 \
  -v "$SCRATCH":/work \
  -v fwasm-emcache:/opt/emsdk/upstream/emscripten/cache \
  -w /work/m1wasm/probes xtb-wasm/flang-wasm:m1 bash -lc '
source /opt/emsdk/emsdk_env.sh >/dev/null 2>&1
export PATH=/opt/flang/host/bin:$PATH
printf "%-24s %-28s %s\n" PROBE "flang-21 native x86_64" "flang-wasm 21.1.8 -> node"
for f in p*.f90; do b=${f%.f90}
  nat=$(flang-21 -o $b.nat $f 2>/dev/null && ./$b.nat 2>&1 | head -1 | cut -c1-26)
  flang -c $f -o $b.o >/dev/null 2>&1
  emcc $b.o -L/opt/flang/wasm/lib -lFortranRuntime -o $b.js >/dev/null 2>&1
  printf "%-24s %-28s %s\n" "$b" "$nat" "$(node $b.js 2>&1 | head -2 | tr "\n" " " | cut -c1-74)"
done'
