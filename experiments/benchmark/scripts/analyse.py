#!/usr/bin/env python3
"""Build the GFN2-xTB cost model from the raw native + occjs benchmark data.

Reads   raw/native_raw.csv (run 2), raw_run1/native_raw.csv (run 1),
        raw/<mol>.<stage>.log, raw/occjs_raw.csv
Writes  results/native_summary.csv, results/scaling_fits.csv,
        results/extrapolation.csv, results/occjs_compare.csv,
        results/cost_model.json
"""
import csv, json, math, os, re
from collections import defaultdict

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(BASE, "raw")
RAW1 = os.path.join(BASE, "raw_run1")
RES = os.path.join(BASE, "results")
os.makedirs(RES, exist_ok=True)

TIME_RE = re.compile(r"(\d+) d,\s+(\d+) h,\s+(\d+) min,\s+([\d.]+) sec")
SECTION_RE = re.compile(r"^ ([A-Za-z][A-Za-z0-9 .\-]*):\s*$")
WASM_LO, WASM_HI = 2.4, 5.5


def parse_sections(path):
    """Return {section: {'wall': s, 'cpu': s}} from an xtb output file."""
    out, cur = {}, None
    try:
        with open(path, errors="replace") as fh:
            lines = fh.readlines()
    except OSError:
        return out
    for line in lines:
        m = SECTION_RE.match(line.rstrip("\n"))
        if m:
            cur = m.group(1).strip()
            continue
        if cur and ("wall-time" in line or "cpu-time" in line):
            t = TIME_RE.search(line)
            if t:
                d, h, mi, s = t.groups()
                secs = int(d) * 86400 + int(h) * 3600 + int(mi) * 60 + float(s)
                out.setdefault(cur, {})["wall" if "wall-time" in line else "cpu"] = secs
    return out


def loglog_fit(xs, ys):
    """Least squares on log(y)=log(a)+b*log(x) -> (a, b, r2)."""
    pts = [(math.log(x), math.log(y)) for x, y in zip(xs, ys) if x > 0 and y > 0]
    n = len(pts)
    if n < 3:
        return None
    sx = sum(p[0] for p in pts); sy = sum(p[1] for p in pts)
    sxx = sum(p[0] * p[0] for p in pts); sxy = sum(p[0] * p[1] for p in pts)
    den = n * sxx - sx * sx
    if abs(den) < 1e-12:
        return None
    b = (n * sxy - sx * sy) / den
    la = (sy - b * sx) / n
    ybar = sy / n
    sstot = sum((p[1] - ybar) ** 2 for p in pts)
    ssres = sum((p[1] - (la + b * p[0])) ** 2 for p in pts)
    return math.exp(la), b, (1 - ssres / sstot if sstot > 0 else float("nan"))


# ---------------------------------------------------------------- load raw
rows = []
for run, path in (("run1", os.path.join(RAW1, "native_raw.csv")),
                  ("run2", os.path.join(RAW, "native_raw.csv"))):
    if not os.path.exists(path):
        continue
    for r in csv.DictReader(open(path)):
        r["run"] = run
        rows.append(r)

agg, meta = defaultdict(list), {}
for r in rows:
    if r["exit"] != "0" or not r["wall_s"]:
        continue
    agg[(r["molecule"], r["stage"])].append(r)
    meta[r["molecule"]] = {
        "natoms": int(r["natoms"]),
        "nao": int(r["nao"]) if r["nao"] else None,
        "nshell": int(r["nshell"]) if r["nshell"] else None,
        "nel": int(r["nel"]) if r["nel"] else None,
    }

summary = {}
for (mol, stage), rs in agg.items():
    cpus = [float(x["user_s"]) + float(x["sys_s"]) for x in rs]
    walls = [float(x["wall_s"]) for x in rs]
    rss = [int(x["maxrss_kb"]) for x in rs]
    secs = parse_sections(os.path.join(RAW, f"{mol}.{stage}.log"))
    cyc = [int(x["opt_cycles"]) for x in rs if x["opt_cycles"]]
    it = [int(x["scc_iters_first"]) for x in rs if x["scc_iters_first"]]
    summary[(mol, stage)] = {
        "n_rep": len(rs),
        "cpu_min": min(cpus), "cpu_med": sorted(cpus)[len(cpus) // 2],
        "cpu_spread": (max(cpus) / min(cpus)) if min(cpus) > 0 else None,
        "wall_min": min(walls),
        "maxrss_kb": max(rss),
        "xtb_total_cpu": secs.get("total", {}).get("cpu"),
        "xtb_scf_cpu": secs.get("SCF", {}).get("cpu"),
        "xtb_hess_cpu": secs.get("analytical hessian", {}).get("cpu"),
        "xtb_opt_cpu": secs.get("ANC optimizer", {}).get("cpu"),
        "opt_cycles": cyc[0] if cyc else None,
        "scc_iters": it[0] if it else None,
    }

mols = sorted(meta, key=lambda m: (meta[m]["natoms"], m))

# ------------------------------------------------------- native summary CSV
hdr = ["molecule", "natoms", "nao", "nshell", "nel", "scc_iters",
       "sp_cpu_s", "sp_scf_cpu_s", "opt_cpu_s", "opt_kernel_cpu_s", "opt_cycles",
       "hess_cpu_s", "hess_kernel_cpu_s", "hess_over_sp", "grad_calls_6N1",
       "t_per_grad_hess_ms", "t_per_grad_sp_ms", "t_per_grad_opt_ms",
       "maxrss_sp_kb", "maxrss_hess_kb", "reps_sp", "reps_hess"]
srows = []
for m in mols:
    d = meta[m]
    sp = summary.get((m, "sp"), {}); op = summary.get((m, "opt"), {}); he = summary.get((m, "hess"), {})
    n61 = 6 * d["natoms"] + 1
    hk, ok, spk = he.get("xtb_hess_cpu"), op.get("xtb_opt_cpu"), sp.get("xtb_scf_cpu")
    cyc = op.get("opt_cycles")
    srows.append({
        "molecule": m, "natoms": d["natoms"], "nao": d["nao"], "nshell": d["nshell"],
        "nel": d["nel"], "scc_iters": sp.get("scc_iters"),
        "sp_cpu_s": sp.get("cpu_min"), "sp_scf_cpu_s": spk,
        "opt_cpu_s": op.get("cpu_min"), "opt_kernel_cpu_s": ok, "opt_cycles": cyc,
        "hess_cpu_s": he.get("cpu_min"), "hess_kernel_cpu_s": hk,
        "hess_over_sp": round(he["cpu_min"] / sp["cpu_min"], 1) if he.get("cpu_min") and sp.get("cpu_min") else None,
        "grad_calls_6N1": n61,
        "t_per_grad_hess_ms": round(hk / (6 * d["natoms"]) * 1000, 2) if hk else None,
        "t_per_grad_sp_ms": round(spk * 1000, 2) if spk else None,
        "t_per_grad_opt_ms": round(ok / cyc * 1000, 2) if ok and cyc else None,
        "maxrss_sp_kb": sp.get("maxrss_kb"), "maxrss_hess_kb": he.get("maxrss_kb"),
        "reps_sp": sp.get("n_rep"), "reps_hess": he.get("n_rep"),
    })
with open(os.path.join(RES, "native_summary.csv"), "w", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=hdr); w.writeheader(); w.writerows(srows)

# ------------------------------------------------------------------- fits
FIT_SETS = {
    "all": mols,
    "N_ge_20": [m for m in mols if meta[m]["natoms"] >= 20],
    "N_ge_40": [m for m in mols if meta[m]["natoms"] >= 40],
    "alkanes": [m for m in mols if m.startswith("alkane") or m == "hexane"],
    "drug_like": [m for m in mols if not m.startswith("alkane")],
}
SERIES = [
    ("sp_total", "sp", "cpu_min"), ("sp_scf", "sp", "xtb_scf_cpu"),
    ("opt_total", "opt", "cpu_min"), ("opt_kernel", "opt", "xtb_opt_cpu"),
    ("hess_total", "hess", "cpu_min"), ("hess_kernel", "hess", "xtb_hess_cpu"),
    ("t_grad_warm", "hess", "t_grad_warm"), ("t_grad_opt", "opt", "t_grad_opt"),
]

# derived per-gradient costs (a displaced gradient restarts from the converged
# reference wavefunction, so it is cheaper than a cold single point)
for m in mols:
    he = summary.get((m, "hess"))
    if he and he.get("xtb_hess_cpu"):
        he["t_grad_warm"] = he["xtb_hess_cpu"] / (6 * meta[m]["natoms"])
    op = summary.get((m, "opt"))
    if op and op.get("xtb_opt_cpu") and op.get("opt_cycles"):
        op["t_grad_opt"] = op["xtb_opt_cpu"] / op["opt_cycles"]
fits = []
for setname, subset in FIT_SETS.items():
    for label, stage, key in SERIES:
        for xname in ("natoms", "nao"):
            xs, ys = [], []
            for m in subset:
                s = summary.get((m, stage))
                if not s or not s.get(key) or s[key] <= 0 or not meta[m][xname]:
                    continue
                xs.append(meta[m][xname]); ys.append(s[key])
            f = loglog_fit(xs, ys)
            if f:
                fits.append({"set": setname, "series": label, "x": xname,
                             "prefactor": f[0], "exponent": f[1], "r2": f[2], "n": len(xs)})
with open(os.path.join(RES, "scaling_fits.csv"), "w", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=["set", "series", "x", "prefactor", "exponent", "r2", "n"])
    w.writeheader()
    for f in fits:
        w.writerow({**f, "prefactor": f"{f['prefactor']:.6g}",
                    "exponent": f"{f['exponent']:.3f}", "r2": f"{f['r2']:.4f}"})

# ------------------------------------------------------------ extrapolation
fit = {(f["set"], f["series"], f["x"]): f for f in fits}


def power(setname, series, x, xv):
    f = fit.get((setname, series, x))
    return f["prefactor"] * xv ** f["exponent"] if f else None


# nao(N) for drug-like organics, fitted from the measured set
nao_fit = loglog_fit([meta[m]["natoms"] for m in mols], [meta[m]["nao"] for m in mols])
# opt cycle count: measured median and 90th-percentile-ish for drug-like molecules
dl_cyc = sorted(s["opt_cycles"] for (m, st), s in summary.items()
                if st == "opt" and s.get("opt_cycles") and not m.startswith("alkane"))
cyc_med = dl_cyc[len(dl_cyc) // 2]
cyc_hi = dl_cyc[int(0.9 * (len(dl_cyc) - 1))]

# Time is far better predicted by nao than by N (r2 0.99 vs 0.95): for a given
# atom count nao/N runs from 1.75 (saturated hydrocarbon) to 2.86 (aromatic,
# heteroatom-rich).  So extrapolate on nao and quote three composition scenarios.
FITSET = "N_ge_20"
NAO_PER_ATOM = {"aliphatic": 2.0, "drug_like": 2.4, "aromatic_rich": 2.8}
ext = []
for N in (10, 20, 30, 40, 50, 60, 80, 100):
    for comp, r in NAO_PER_ATOM.items():
        nao = r * N
        tg = power(FITSET, "t_grad_warm", "nao", nao)     # one warm-started gradient
        hess = power(FITSET, "hess_kernel", "nao", nao)   # 6N warm grads + assembly
        opt_med, opt_hi = cyc_med * tg, cyc_hi * tg
        for lbl, nat in (("one_gradient", tg), ("opt_median_cycles", opt_med),
                         ("opt_p90_cycles", opt_hi), ("hess", hess),
                         ("opt_median+hess", opt_med + hess),
                         ("opt_p90+hess", opt_hi + hess)):
            ext.append({"natoms": N, "composition": comp, "nao": round(nao),
                        "stage": lbl, "native_s": round(nat, 2),
                        "wasm_lo_s": round(nat * WASM_LO, 1),
                        "wasm_hi_s": round(nat * WASM_HI, 1),
                        "verdict_lo": ("interactive" if nat * WASM_LO < 30 else
                                       "slow" if nat * WASM_LO < 300 else "impractical"),
                        "verdict_hi": ("interactive" if nat * WASM_HI < 30 else
                                       "slow" if nat * WASM_HI < 300 else "impractical")})

# model-vs-measured check on the real molecules
check = []
for m in mols:
    he = summary.get((m, "hess"))
    if not he or not he.get("xtb_hess_cpu"):
        continue
    pred = power(FITSET, "hess_kernel", "nao", meta[m]["nao"])
    check.append({"molecule": m, "natoms": meta[m]["natoms"], "nao": meta[m]["nao"],
                  "hess_measured_s": round(he["xtb_hess_cpu"], 3),
                  "hess_model_s": round(pred, 3),
                  "model_over_measured": round(pred / he["xtb_hess_cpu"], 3)})
with open(os.path.join(RES, "model_check.csv"), "w", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=list(check[0])); w.writeheader(); w.writerows(check)

with open(os.path.join(RES, "extrapolation.csv"), "w", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=list(ext[0])); w.writeheader(); w.writerows(ext)

# ----------------------------------------------------------- occjs compare
occ_path = os.path.join(RAW, "occjs_raw.csv")
occ_rows = []
if os.path.exists(occ_path):
    oagg = defaultdict(list)
    for r in csv.DictReader(open(occ_path)):
        if r.get("ms"):
            oagg[(r["molecule"], r["stage"])].append(float(r["ms"]) / 1000)
    for m in mols:
        for stage in ("sp", "hess"):
            ts = oagg.get((m, stage))
            if not ts:
                continue
            nat_key = "sp" if stage == "sp" else "hess"
            native = summary.get((m, nat_key), {}).get("cpu_min")
            nat_kernel = (summary.get((m, "sp"), {}).get("xtb_scf_cpu") if stage == "sp"
                          else summary.get((m, "hess"), {}).get("xtb_hess_cpu"))
            occ_rows.append({
                "molecule": m, "natoms": meta[m]["natoms"], "stage": stage,
                "occjs_wasm_s": round(min(ts), 4), "n_rep": len(ts),
                "xtb_native_total_s": native,
                "xtb_native_kernel_s": nat_kernel,
                "ratio_vs_kernel": round(min(ts) / nat_kernel, 2) if nat_kernel else None,
            })
    with open(os.path.join(RES, "occjs_compare.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(occ_rows[0])); w.writeheader(); w.writerows(occ_rows)

json.dump({"meta": meta,
           "summary": {f"{k[0]}|{k[1]}": v for k, v in summary.items()},
           "fits": fits,
           "nao_vs_natoms": {"prefactor": nao_fit[0], "exponent": nao_fit[1], "r2": nao_fit[2]},
           "extrapolation_fitset": FITSET,
           "opt_cycles_drug_like": {"median": cyc_med, "p90": cyc_hi, "all": dl_cyc},
           "wasm_penalty": {"low": WASM_LO, "high": WASM_HI},
           "extrapolation": ext,
           "nao_per_atom_scenarios": NAO_PER_ATOM,
           "model_check": check,
           "occjs": occ_rows},
          open(os.path.join(RES, "cost_model.json"), "w"), indent=2)

print(f"{len(mols)} molecules, {len(fits)} fits -> {RES}")
print(f"nao ~ {nao_fit[0]:.3f} N^{nao_fit[1]:.3f} (r2={nao_fit[2]:.4f})")
print(f"opt cycles drug-like: median={cyc_med} p90={cyc_hi} all={dl_cyc}")
for f in fits:
    if f["set"] in ("all", "N_ge_20"):
        print(f"  {f['set']:8s} {f['series']:11s} t ~ {f['x']}^{f['exponent']:.2f}  r2={f['r2']:.3f}  n={f['n']}")
