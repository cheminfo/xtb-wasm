#!/usr/bin/env bash
# Fortran -> wasm on macOS arm64, measured 2026-08-28.
# FLANG must point at an LLVM release that ships lib/clang/21/lib/wasm32-unknown-emscripten/
set -euo pipefail
FLANG=${FLANG:?set FLANG=/path/to/flang+llvm-21.1.8}
FL=$FLANG/bin/flang
RT=$FLANG/lib/clang/21/lib/wasm32-unknown-emscripten/libflang_rt.runtime.wasm32.a
# NOTE: do NOT pass -fopenmp: no wasm libomp exists, wasm-ld fails on __kmpc_* symbols.
$FL --target=wasm32-unknown-emscripten -O2 -c "$1" -o /tmp/f.o
emcc -O2 /tmp/f.o "$RT" -o "${2:-a.out.js}"
