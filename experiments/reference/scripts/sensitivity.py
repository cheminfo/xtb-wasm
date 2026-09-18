#!/usr/bin/env python3
"""How far do results move when the *input* is perturbed at rounding scale?

The native build variants agree to print precision, so they give a floor of ~0
and no headroom guidance. This probes the other end: perturb the input geometry
by a known epsilon and run the full --ohess pipeline, which is what a consumer
of the fixtures actually does. The response tells us how much a different
toolchain's accumulated rounding could plausibly move the reported numbers.
"""
import json, os, random, re, shutil, subprocess

XTB = "/opt/work/xtb-B/_build_wasmshape/xtb"
MOLS = "benzene acetic_acid paracetamol caffeine".split()
EPS = [0.0, 1e-8, 1e-6, 1e-4]
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


def perturbed_xyz(src, dst, eps, seed):
    rng = random.Random(seed)
    lines = open(src).read().splitlines()
    n = int(lines[0].split()[0])
    out = [lines[0], lines[1]]
    for line in lines[2:2 + n]:
        p = line.split()
        xyz = [float(v) + (rng.uniform(-eps, eps) if eps else 0.0) for v in p[1:4]]
        out.append(f"{p[0]:<3s}{xyz[0]:>22.14f}{xyz[1]:>22.14f}{xyz[2]:>22.14f}")
    open(dst, "w").write("\n".join(out) + "\n")


def run(mol, eps, seed):
    work = f"/tmp/senswork/{mol}/{eps}_{seed}"
    shutil.rmtree(work, ignore_errors=True); os.makedirs(work)
    perturbed_xyz(f"/tmp/refwork/wasm-shaped/{mol}/optimized.xyz", f"{work}/in.xyz", eps, seed)
    env = dict(os.environ); env.pop("XTBPATH", None); env.pop("XTBHOME", None)
    env["OMP_NUM_THREADS"] = "1"; env["OPENBLAS_NUM_THREADS"] = "1"
    with open(f"{work}/run.out", "w") as fh:
        rc = subprocess.run([XTB, "in.xyz", "--ohess", "--gfn", "2", "--chrg", "0", "--uhf", "0"],
                            cwd=work, stdout=fh, stderr=subprocess.STDOUT, env=env).returncode
    if rc != 0:
        return None
    text = open(f"{work}/run.out").read()
    m = re.search(r"TOTAL ENERGY\s+(-?[\d.]+)\s+Eh", text)
    f, i = parse_vib(f"{work}/vibspectrum")
    return {"energy": float(m.group(1)), "freqs": f, "ints": i}


report = {"schema": "xtb-wasm/input-sensitivity/1",
          "description": "Full --ohess pipeline restarted from the reference optimized geometry "
                         "perturbed by a uniform random displacement of +/- eps Angstrom per coordinate.",
          "molecules": {}}
print(f"{'molecule':<14}{'eps (A)':>10}{'seed':>6}{'dE (Eh)':>12}{'max df':>10}{'mean df':>10}{'max dI':>10}{'maxrelI':>10}")
for mol in MOLS:
    base = run(mol, 0.0, 0)
    recs = []
    for eps in EPS[1:]:
        for seed in (1, 2):
            r = run(mol, eps, seed)
            if r is None or len(r["freqs"]) != len(base["freqs"]):
                print(f"{mol:<14}{eps:>10.0e}{seed:>6} mismatch/failed"); continue
            df = [abs(a - b) for a, b in zip(base["freqs"], r["freqs"])]
            di = [abs(a - b) for a, b in zip(base["ints"], r["ints"])]
            rel = [abs(a - b) / b for a, b in zip(r["ints"], base["ints"]) if b > 1.0]
            rec = {"eps": eps, "seed": seed,
                   "energy_abs_diff": abs(base["energy"] - r["energy"]),
                   "freq_max_abs_cm1": max(df), "freq_mean_abs_cm1": sum(df) / len(df),
                   "intensity_max_abs_km_mol": max(di),
                   "intensity_max_rel_above_1kmmol": max(rel) if rel else 0.0}
            recs.append(rec)
            print(f"{mol:<14}{eps:>10.0e}{seed:>6}{rec['energy_abs_diff']:>12.2e}"
                  f"{rec['freq_max_abs_cm1']:>10.2f}{rec['freq_mean_abs_cm1']:>10.3f}"
                  f"{rec['intensity_max_abs_km_mol']:>10.3f}{rec['intensity_max_rel_above_1kmmol']:>10.2e}", flush=True)
    report["molecules"][mol] = {"n_modes": len(base["freqs"]), "reference_energy": base["energy"], "perturbations": recs}

os.makedirs(OUT, exist_ok=True)
with open(f"{OUT}/input_sensitivity.json", "w") as fh:
    json.dump(report, fh, indent=2); fh.write("\n")
