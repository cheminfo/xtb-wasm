#!/usr/bin/env python3
"""Compare the FP-perturbed build (D) against the reference build (B).

D is compiled with -O1 -ffp-contract=off against reference netlib LAPACK, so it
differs from B in FMA contraction, vectorisation and the linear-algebra backend.
That is the closest native proxy available for the floating-point reassociation a
different toolchain (flang-wasm / wasm libm) will introduce.
"""
import json, os, re, shutil, subprocess

MOLS = "water methanol benzene acetic_acid toluene paracetamol aspirin caffeine ibuprofen cholesterol".split()
B = "/opt/work/xtb-B/_build_wasmshape/xtb"
D = "/opt/work/xtb-D/_build_fp/xtb"
OUT = "/out/tolerance"


def parse_vib(path):
    freqs, ints = [], []
    for line in open(path):
        if line.startswith(("$", "#")):
            continue
        parts = line.split()
        if not parts or not parts[0].isdigit():
            continue
        nums = []
        for p in parts[1:]:
            try:
                nums.append(float(p))
            except ValueError:
                pass
        if len(nums) >= 2:
            freqs.append(nums[0]); ints.append(nums[1])
        elif len(nums) == 1:
            freqs.append(nums[0]); ints.append(0.0)
    keep = [i for i, f in enumerate(freqs) if abs(f) > 0.01]
    return [freqs[i] for i in keep], [ints[i] for i in keep]


def parse_hessian(path):
    vals = []
    for line in open(path):
        if line.startswith("$") or "hessian" in line:
            continue
        for p in line.split():
            try:
                vals.append(float(p))
            except ValueError:
                pass
    return vals


def run(tag, binary, mol, env_extra):
    work = f"/tmp/fpwork/{tag}/{mol}"
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work)
    shutil.copy(f"/tmp/refwork/wasm-shaped/{mol}/optimized.xyz", f"{work}/in.xyz")
    env = dict(os.environ); env.pop("XTBPATH", None); env.pop("XTBHOME", None)
    env.update(env_extra)
    with open(f"{work}/run.out", "w") as fh:
        rc = subprocess.run([binary, "in.xyz", "--ohess", "--gfn", "2", "--chrg", "0", "--uhf", "0"],
                            cwd=work, stdout=fh, stderr=subprocess.STDOUT, env=env).returncode
    if rc != 0:
        return None
    text = open(f"{work}/run.out").read()
    m = re.search(r"TOTAL ENERGY\s+(-?[\d.]+)\s+Eh", text)
    f, i = parse_vib(f"{work}/vibspectrum")
    h = parse_hessian(f"{work}/hessian") if os.path.exists(f"{work}/hessian") else []
    return {"energy": float(m.group(1)), "freqs": f, "ints": i, "hess": h}


report = {"schema": "xtb-wasm/fp-perturbation-study/1",
          "reference": "B = -O3 release, OpenBLAS, OMP off",
          "perturbed": "D = -O1 -ffp-contract=off -fno-unsafe-math-optimizations, netlib reference LAPACK/BLAS, OMP off",
          "molecules": {}}
print(f"{'molecule':<14}{'dE (Eh)':>12}{'max df':>10}{'max dI':>10}{'maxrelI>1':>11}{'max dHess':>12}")
for mol in MOLS:
    b = run("B", B, mol, {"OMP_NUM_THREADS": "1", "OPENBLAS_NUM_THREADS": "1"})
    d = run("D", D, mol, {"OMP_NUM_THREADS": "1",
                          "LD_LIBRARY_PATH": "/usr/lib/aarch64-linux-gnu/lapack:/usr/lib/aarch64-linux-gnu/blas"})
    if b is None or d is None or len(b["freqs"]) != len(d["freqs"]):
        print(f"{mol:<14} FAILED/mismatch"); continue
    df = [abs(x - y) for x, y in zip(b["freqs"], d["freqs"])]
    di = [abs(x - y) for x, y in zip(b["ints"], d["ints"])]
    rel = [abs(x - y) / y for x, y in zip(d["ints"], b["ints"]) if y > 1.0]
    dh = max((abs(x - y) for x, y in zip(b["hess"], d["hess"])), default=float("nan")) if len(b["hess"]) == len(d["hess"]) else float("nan")
    rec = {"n_modes": len(b["freqs"]), "energy_B": b["energy"], "energy_D": d["energy"],
           "energy_abs_diff": abs(b["energy"] - d["energy"]),
           "freq_max_abs_cm1": max(df), "freq_mean_abs_cm1": sum(df) / len(df),
           "intensity_max_abs_km_mol": max(di),
           "intensity_max_rel_above_1kmmol": max(rel) if rel else 0.0,
           "hessian_n_elements": len(b["hess"]), "hessian_max_abs_diff": dh}
    report["molecules"][mol] = rec
    print(f"{mol:<14}{rec['energy_abs_diff']:>12.2e}{rec['freq_max_abs_cm1']:>10.2f}"
          f"{rec['intensity_max_abs_km_mol']:>10.3f}{rec['intensity_max_rel_above_1kmmol']:>11.2e}{dh:>12.2e}", flush=True)

os.makedirs(OUT, exist_ok=True)
with open(f"{OUT}/fp_perturbation_study.json", "w") as fh:
    json.dump(report, fh, indent=2); fh.write("\n")
