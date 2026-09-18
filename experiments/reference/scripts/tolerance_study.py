#!/usr/bin/env python3
"""Measure the reproducibility spread of xtb GFN2 --ohess results.

Runs the same molecules under several build / threading / LAPACK variants and
reports the observed spread, which is what the validation tolerances are
derived from.
"""

import json
import os
import re
import shutil
import subprocess
import sys

GEOMDIR = "/out/geom"
OUT = os.environ.get("TOL_OUT", "/out/tolerance")
MOLS = os.environ.get(
    "TOL_MOLECULES", "water acetic_acid benzene toluene paracetamol"
).split()

VARIANTS = [
    # label, xtb binary, extra env
    (
        "B_omp1_openblas1",
        "/opt/work/xtb-B/_build_wasmshape/xtb",
        {"OMP_NUM_THREADS": "1", "OPENBLAS_NUM_THREADS": "1"},
    ),
    (
        "B_repeat_identical",
        "/opt/work/xtb-B/_build_wasmshape/xtb",
        {"OMP_NUM_THREADS": "1", "OPENBLAS_NUM_THREADS": "1"},
    ),
    (
        "B_omp1_openblas4",
        "/opt/work/xtb-B/_build_wasmshape/xtb",
        {"OMP_NUM_THREADS": "1", "OPENBLAS_NUM_THREADS": "4"},
    ),
    (
        "A_omp1_openblas1",
        "/opt/work/xtb-A/_build_default/xtb",
        {"OMP_NUM_THREADS": "1", "OPENBLAS_NUM_THREADS": "1"},
    ),
    (
        "A_omp4_openblas4",
        "/opt/work/xtb-A/_build_default/xtb",
        {"OMP_NUM_THREADS": "4", "OPENBLAS_NUM_THREADS": "4"},
    ),
    (
        "C_omp1_netlib_reference",
        "/opt/work/xtb-C/_build_netlib/xtb",
        {
            "OMP_NUM_THREADS": "1",
            "LD_LIBRARY_PATH": "/usr/lib/aarch64-linux-gnu/lapack:/usr/lib/aarch64-linux-gnu/blas",
        },
    ),
]


def parse_vibspectrum(path):
    freqs, ints = [], []
    for line in open(path):
        if line.startswith("$") or line.startswith("#"):
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
            freqs.append(nums[0])
            ints.append(nums[1])
        elif len(nums) == 1:
            freqs.append(nums[0])
            ints.append(0.0)
    keep = [i for i, f in enumerate(freqs) if abs(f) > 0.01]
    return [freqs[i] for i in keep], [ints[i] for i in keep]


def run(label, binary, env_extra, mol):
    if not os.path.exists(binary):
        return None
    work = os.path.join("/tmp/tolwork", label, mol)
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work)
    # start from the reference-optimized geometry so only the Hessian path varies
    src = f"/tmp/refwork/wasm-shaped/{mol}/optimized.xyz"
    if not os.path.exists(src):
        src = os.path.join(GEOMDIR, mol + ".xyz")
    shutil.copy(src, os.path.join(work, "in.xyz"))
    env = dict(os.environ)
    env.pop("XTBPATH", None)
    env.pop("XTBHOME", None)
    env.update(env_extra)
    with open(os.path.join(work, "run.out"), "w") as fh:
        rc = subprocess.run(
            [binary, "in.xyz", "--ohess", "--gfn", "2", "--chrg", "0", "--uhf", "0"],
            cwd=work, stdout=fh, stderr=subprocess.STDOUT, env=env,
        ).returncode
    if rc != 0:
        return None
    text = open(os.path.join(work, "run.out")).read()
    m = re.search(r"TOTAL ENERGY\s+(-?[\d.]+)\s+Eh", text)
    freqs, ints = parse_vibspectrum(os.path.join(work, "vibspectrum"))
    return {
        "energy": float(m.group(1)) if m else None,
        "frequencies": freqs,
        "ir_intensities": ints,
    }


def main():
    os.makedirs(OUT, exist_ok=True)
    report = {"schema": "xtb-wasm/tolerance-study/1", "molecules": {}}
    for mol in MOLS:
        results = {}
        for label, binary, env_extra in VARIANTS:
            r = run(label, binary, env_extra, mol)
            if r is not None:
                results[label] = r
                print(f"[{mol}] {label}: E={r['energy']}", flush=True)
            else:
                print(f"[{mol}] {label}: UNAVAILABLE", flush=True)
        if len(results) < 2:
            continue
        base_label = "B_omp1_openblas1"
        base = results[base_label]
        deltas = {}
        for label, r in results.items():
            if label == base_label:
                continue
            d = {"energy_abs": abs(r["energy"] - base["energy"])}
            if len(r["frequencies"]) == len(base["frequencies"]):
                fd = [abs(a - b) for a, b in zip(r["frequencies"], base["frequencies"])]
                idd = [
                    abs(a - b)
                    for a, b in zip(r["ir_intensities"], base["ir_intensities"])
                ]
                d["freq_max_abs_cm1"] = max(fd) if fd else 0.0
                d["freq_mean_abs_cm1"] = (sum(fd) / len(fd)) if fd else 0.0
                d["intensity_max_abs_km_mol"] = max(idd) if idd else 0.0
                # relative intensity error, only for peaks above 1 km/mol
                rel = [
                    abs(a - b) / b
                    for a, b in zip(r["ir_intensities"], base["ir_intensities"])
                    if b > 1.0
                ]
                d["intensity_max_rel_above_1kmmol"] = max(rel) if rel else 0.0
            else:
                d["mode_count_mismatch"] = [
                    len(base["frequencies"]),
                    len(r["frequencies"]),
                ]
            deltas[label] = d
        report["molecules"][mol] = {
            "n_modes": len(base["frequencies"]),
            "reference_variant": base_label,
            "reference_energy": base["energy"],
            "deltas_vs_reference": deltas,
            "raw": results,
        }
    with open(os.path.join(OUT, "tolerance_study.json"), "w") as fh:
        json.dump(report, fh, indent=2)
        fh.write("\n")

    print("\n=== SPREAD SUMMARY (vs B_omp1_openblas1) ===")
    hdr = f"{'molecule':<14}{'variant':<20}{'dE (Eh)':>12}{'max df':>10}{'max dI':>10}{'max relI':>10}"
    print(hdr)
    for mol, m in report["molecules"].items():
        for label, d in m["deltas_vs_reference"].items():
            print(
                f"{mol:<14}{label:<20}{d['energy_abs']:>12.2e}"
                f"{d.get('freq_max_abs_cm1', float('nan')):>10.4f}"
                f"{d.get('intensity_max_abs_km_mol', float('nan')):>10.4f}"
                f"{d.get('intensity_max_rel_above_1kmmol', float('nan')):>10.2e}"
            )


if __name__ == "__main__":
    sys.exit(main())
