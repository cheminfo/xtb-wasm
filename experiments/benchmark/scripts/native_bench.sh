#!/bin/bash
# Native single-threaded xtb 6.7.1 GFN2 benchmark.
# Stages: sp (energy+gradient), opt (geometry optimisation), hess (numerical Hessian).
# Runs INSIDE the xtbnat:bench container.  Emits one CSV row per (molecule, stage).
set -u
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 OMP_STACKSIZE=1G
ulimit -s unlimited 2>/dev/null

MOL=/work/mol
OUT=${OUT:-/work/raw}
STAGES=${STAGES:-sp opt hess}
REPEATS=${REPEATS:-1}
mkdir -p "$OUT"
CSV=$OUT/native_raw.csv
[ -f "$CSV" ] || echo "molecule,natoms,stage,rep,wall_s,user_s,sys_s,maxrss_kb,nao,nshell,nel,scf_calls,scc_iters_first,opt_cycles,exit" > "$CSV"

timed() {  # name natoms stage rep -- cmd...
  local name=$1 nat=$2 stage=$3 rep=$4; shift 4
  local tf=/tmp/t.$$ log=$OUT/${name}.${stage}.log
  /usr/bin/time -f "%e %U %S %M" -o "$tf" "$@" > "$log" 2>&1
  local ec=$?
  read -r wall user sys rss < "$tf"; rm -f "$tf"
  local nao ns nel calls it cyc
  nao=$(grep -m1 -oE '# basis functions +[0-9]+' "$log" | grep -oE '[0-9]+')
  ns=$(grep -m1 -oE '# shells +[0-9]+'          "$log" | grep -oE '[0-9]+')
  nel=$(grep -m1 -oE '# electrons +[0-9]+'      "$log" | grep -oE '[0-9]+')
  calls=$(grep -c 'convergence criteria satisfied' "$log")
  it=$(grep -m1 -oE 'convergence criteria satisfied after +[0-9]+' "$log" | grep -oE '[0-9]+$')
  cyc=$(grep -m1 -oE 'GEOMETRY OPTIMIZATION CONVERGED AFTER +[0-9]+' "$log" | grep -oE '[0-9]+$')
  echo "$name,$nat,$stage,$rep,$wall,$user,$sys,$rss,${nao:-},${ns:-},${nel:-},${calls:-0},${it:-},${cyc:-},$ec" >> "$CSV"
  printf "  %-5s %-14s N=%-3s rep=%s wall=%7ss user=%7ss rss=%8skB nao=%-4s scf=%-4s cyc=%-4s exit=%s\n" \
    "$stage" "$name" "$nat" "$rep" "$wall" "$user" "$rss" "${nao:-?}" "${calls:-0}" "${cyc:-}" "$ec"
}

for name in "$@"; do
  f=$MOL/$name.xyz
  [ -f "$f" ] || { echo "MISSING $f"; continue; }
  nat=$(head -1 "$f" | tr -d ' \r')
  d=/tmp/run_$name; rm -rf "$d"; mkdir -p "$d"; cd "$d" || continue
  cp "$f" in.xyz
  echo "=== $name (N=$nat) ==="
  for rep in $(seq 1 "$REPEATS"); do
    case " $STAGES " in *" sp "*)
      rm -f xtbrestart; timed "$name" "$nat" sp "$rep" xtb in.xyz --gfn 2 --grad --norestart ;;
    esac
  done
  case " $STAGES " in *" opt "*)
    for rep in $(seq 1 "$REPEATS"); do
      rm -f xtbrestart xtbopt.xyz
      timed "$name" "$nat" opt "$rep" xtb in.xyz --gfn 2 --opt --norestart
    done
    [ -f xtbopt.xyz ] && cp xtbopt.xyz /work/mol/${name}_opt.xyz ;;
  esac
  case " $STAGES " in *" hess "*)
    if [ -f /work/mol/${name}_opt.xyz ]; then cp /work/mol/${name}_opt.xyz opt.xyz; else cp in.xyz opt.xyz; fi
    for rep in $(seq 1 "$REPEATS"); do
      rm -f xtbrestart
      timed "$name" "$nat" hess "$rep" xtb opt.xyz --gfn 2 --hess --norestart
    done ;;
  esac
  cd /work || exit
done
