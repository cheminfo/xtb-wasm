#!/bin/bash
# Enumerate every test-drive subtest inside xtb's own unit tester and tally
# PASSED / FAILED / SKIPPED. $1 = path to the tester binary, $2 = output tsv
TESTER="$1"
OUT="$2"
SUITES="atomlist coordinationnumber coulomb dftd3 dftd4 detrotra docking eeq gfn0 gfn1 gfn2 gfnff hessian iff latticepoint molecule oniom dipro pbc-tools peeq random repulsion symmetry tblite thermo vertical wsc cpx ptb"
: > "$OUT"
for s in $SUITES; do
  raw=$("$TESTER" "$s" 2>&1)
  echo "$raw" | grep -E '\[(PASSED|FAILED|SKIPPED)\]' | sed -E 's/^ *\.\.\. //' | while read -r line; do
    status=$(echo "$line" | grep -oE '\[(PASSED|FAILED|SKIPPED)\]' | tr -d '[]')
    name=$(echo "$line" | sed -E 's/ *\[(PASSED|FAILED|SKIPPED)\].*//' | sed 's/ *$//')
    reason=$(echo "$raw" | grep -A1 -F "... $name [$status]" | grep -E '^ *Message:' | head -1 | sed -E 's/^ *Message: *//')
    printf '%s\t%s\t%s\t%s\n' "$s" "$name" "$status" "$reason" >> "$OUT"
  done
done
echo "--- totals ---"
awk -F'\t' '{c[$3]++} END {for (k in c) print k, c[k]}' "$OUT" | sort
echo "total subtests: $(wc -l < "$OUT")"
