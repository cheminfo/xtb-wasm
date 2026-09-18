#!/usr/bin/env python3
"""Add a tier-1 block to each fixture.

The fixtures' vibrational data came from --ohess, which re-optimizes before
building the Hessian, so it does not correspond exactly to the stored optimized
geometry. Tier-1 validation runs --hess *at* that geometry, so it needs its own
reference block; otherwise IR intensities of the larger molecules disagree by up
to 16% with the same binary.
"""
import json, os, re, shutil, subprocess

XTB = "/opt/work/xtb-B/_build_wasmshape/xtb"
FIX = "/ref/fixtures"


def write_xyz(path, g):
    lines = [str(g["n_atoms"]), g.get("comment", "")]
    for a in g["atoms"]:
        lines.append(f"{a['symbol']:<3s}{a['x']:>22.14f}{a['y']:>22.14f}{a['z']:>22.14f}")
    open(path, "w").write("\n".join(lines) + "\n")


def parse_vib(path):
    freqs, ints = [], []
    for line in open(path):
        if line.startswith(("$", "#")):
            continue
        p = line.split()
        if not p or not p[0].isdigit():
            continue
        nums = []
        for t in p[1:]:
            try:
                nums.append(float(t))
            except ValueError:
                pass
        if len(nums) >= 2:
            freqs.append(nums[0]); ints.append(nums[1])
        elif len(nums) == 1:
            freqs.append(nums[0]); ints.append(0.0)
    pairs = sorted([(f, i) for f, i in zip(freqs, ints) if abs(f) > 0.01])
    return [p[0] for p in pairs], [p[1] for p in pairs], freqs, ints


def invariants(path, n_atoms):
    total = trace = 0.0
    dim = 3 * n_atoms
    idx = 0
    for line in open(path):
        if line.startswith("$") or "hessian" in line:
            continue
        for t in line.split():
            try:
                v = float(t)
            except ValueError:
                continue
            total += v * v
            if idx % (dim + 1) == 0:
                trace += v
            idx += 1
    return {"dimension": dim, "frobenius_norm": total ** 0.5, "trace": trace,
            "n_elements": idx, "valid": idx == dim * dim}


index = json.load(open(f"{FIX}/index.json"))
for m in index["molecules"]:
    name = m["name"]
    path = f"{FIX}/{name}.json"
    fx = json.load(open(path))
    work = f"/tmp/tier1gen/{name}"
    shutil.rmtree(work, ignore_errors=True); os.makedirs(work)
    write_xyz(f"{work}/in.xyz", fx["optimized_geometry_xyz"])
    env = dict(os.environ); env.pop("XTBPATH", None); env.pop("XTBHOME", None)
    env["OMP_NUM_THREADS"] = "1"; env["OPENBLAS_NUM_THREADS"] = "1"
    with open(f"{work}/run.out", "w") as fh:
        rc = subprocess.run([XTB, "in.xyz", "--hess", "--gfn", "2",
                             "--chrg", str(fx["molecule"]["charge"]),
                             "--uhf", str(fx["molecule"]["uhf"])],
                            cwd=work, stdout=fh, stderr=subprocess.STDOUT, env=env).returncode
    assert rc == 0, name
    text = open(f"{work}/run.out").read()
    energy = float(re.search(r"TOTAL ENERGY\s+(-?[\d.]+)\s+Eh", text).group(1))
    f, i, allf, alli = parse_vib(f"{work}/vibspectrum")
    zpve = re.search(r"zero point energy\s+(-?[\d.]+)", text)
    fx["tier1_hess_at_optimized_geometry"] = {
        "description": "Reference for the tier-1 validation protocol: `xtb optimized.xyz --hess "
                       "--gfn 2` run at exactly the coordinates in optimized_geometry_xyz, with no "
                       "optimizer step. Use THIS block when validating with --hess; the top-level "
                       "`vibrations` block came from --ohess, which relaxes the geometry a little "
                       "further first and therefore reports slightly different IR intensities.",
        "command": "xtb optimized.xyz --hess --gfn 2 --chrg <charge> --uhf <uhf>",
        "total_energy_hartree": energy,
        "zero_point_energy_hartree": float(zpve.group(1)) if zpve else None,
        "units": {"frequency": "cm^-1", "ir_intensity": "km/mol"},
        "n_vibrational_modes": len(f),
        "n_imaginary": sum(1 for v in f if v < 0.0),
        "frequencies": f,
        "ir_intensities": i,
        "all_modes_including_trans_rot": {"frequencies": allf, "ir_intensities": alli},
        "hessian_invariants": invariants(f"{work}/hessian", fx["molecule"]["n_atoms"]),
    }
    json.dump(fx, open(path, "w"), indent=2)
    open(path, "a").write("\n")
    print(f"{name:<14} E={energy:.12f} modes={len(f)} imag={sum(1 for v in f if v<0)}", flush=True)
