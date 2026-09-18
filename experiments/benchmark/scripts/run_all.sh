#!/bin/bash
# Driver: full native sweep, 3 passes so reps of one molecule are spread in time.
set -u
cd /work || exit 1
MOLS="water methanol alkane_c2 ethanol benzene phenol alkane_c4 naphthalene hexane aspirin caffeine alkane_c8 ibuprofen alkane_c12 estradiol sucrose alkane_c16 alkane_c20 sildenafil alkane_c24 cholesterol betacarotene alkane_c32"
echo "### PASS sp"
STAGES=sp   REPEATS=5 bash /work/scripts/native_bench.sh $MOLS
echo "### PASS opt"
STAGES=opt  REPEATS=2 bash /work/scripts/native_bench.sh $MOLS
echo "### PASS hess"
STAGES=hess REPEATS=2 bash /work/scripts/native_bench.sh $MOLS
echo "### DONE"
