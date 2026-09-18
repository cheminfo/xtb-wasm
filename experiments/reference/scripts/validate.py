#!/usr/bin/env python3
"""Validate an xtb build against the reference fixtures.

Tier 1 (default): runs `xtb --hess` from each fixture's stored optimized
geometry, so the ANC optimizer is excluded and only the SCF, the finite
difference Hessian and the dipole gradients are compared. Tolerances come from
tolerances.json.

    python3 validate.py /path/to/xtb                      # all fixtures, tier 1
    python3 validate.py /path/to/xtb --only water benzene
    python3 validate.py /path/to/xtb --tier 2             # full --ohess pipeline

Exit status is 0 only if every checked molecule passes.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REPO = os.path.dirname(os.path.dirname(ROOT))
# The fixtures are the ones the library ships, so the harness and the browser
# are judged against the same bytes.
FIXTURES = os.path.join(REPO, "src", "reference", "fixtures")
GEOMETRIES = os.path.join(ROOT, "geometries")

TIER1 = {
    "energy_abs_eh": 1e-8,
    "freq_abs_cm1": 0.5,
    "intensity_rel_above": 0.02,
    "intensity_abs_below_km_mol": 0.05,
    "intensity_strong_threshold": 1.0,
    "hessian_invariant_rel": 1e-6,
}
TIER2 = {
    "energy_abs_eh": 1e-5,
    "freq_abs_cm1_stiff": 5.0,
    "freq_abs_cm1_soft": 25.0,
    "freq_soft_cutoff": 500.0,
    "intensity_rel_above": 0.5,
    "intensity_strong_threshold": 5.0,
}


def write_xyz(path, geometry):
    lines = [str(geometry["n_atoms"]), geometry.get("comment", "")]
    for a in geometry["atoms"]:
        lines.append(f"{a['symbol']:<3s}{a['x']:>22.14f}{a['y']:>22.14f}{a['z']:>22.14f}")
    with open(path, "w") as fh:
        fh.write("\n".join(lines) + "\n")


def parse_vibspectrum(path):
    """Return (frequencies, intensities) with translations/rotations removed."""
    freqs, ints = [], []
    with open(path) as fh:
        for line in fh:
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
                freqs.append(nums[0])
                ints.append(nums[1])
            elif len(nums) == 1:
                freqs.append(nums[0])
                ints.append(0.0)
    pairs = [(f, i) for f, i in zip(freqs, ints) if abs(f) > 0.01]
    pairs.sort(key=lambda t: t[0])
    return [p[0] for p in pairs], [p[1] for p in pairs]


def hessian_invariants(path, n_atoms):
    total = 0.0
    trace = 0.0
    dimension = 3 * n_atoms
    index = 0
    with open(path) as fh:
        for line in fh:
            if line.startswith("$") or "hessian" in line:
                continue
            for token in line.split():
                try:
                    value = float(token)
                except ValueError:
                    continue
                total += value * value
                if index % (dimension + 1) == 0:
                    trace += value
                index += 1
    return {"frobenius_norm": total ** 0.5, "trace": trace, "dimension": dimension}


def run_xtb(binary, workdir, xyz_name, mode, charge, uhf):
    env = dict(os.environ)
    env.pop("XTBPATH", None)
    env.pop("XTBHOME", None)
    env.setdefault("OMP_NUM_THREADS", "1")
    with open(os.path.join(workdir, "run.out"), "w") as fh:
        result = subprocess.run(
            [binary, xyz_name, mode, "--gfn", "2", "--chrg", str(charge), "--uhf", str(uhf)],
            cwd=workdir, stdout=fh, stderr=subprocess.STDOUT, env=env,
        )
    if result.returncode != 0:
        return None
    text = open(os.path.join(workdir, "run.out")).read()
    match = re.search(r"TOTAL ENERGY\s+(-?[\d.]+)\s+Eh", text)
    return float(match.group(1)) if match else None


def check(fixture, binary, tier, scratch):
    name = fixture["molecule"]["name"]
    n_atoms = fixture["molecule"]["n_atoms"]
    workdir = os.path.join(scratch, f"tier{tier}", name)
    shutil.rmtree(workdir, ignore_errors=True)
    os.makedirs(workdir)

    if tier == 1:
        write_xyz(os.path.join(workdir, "in.xyz"), fixture["optimized_geometry_xyz"])
        mode = "--hess"
    else:
        shutil.copy(os.path.join(GEOMETRIES, name + ".xyz"), os.path.join(workdir, "in.xyz"))
        mode = "--ohess"

    energy = run_xtb(binary, workdir, "in.xyz", mode,
                     fixture["molecule"]["charge"], fixture["molecule"]["uhf"])
    if energy is None:
        return [f"xtb exited non-zero or printed no TOTAL ENERGY (see {workdir}/run.out)"]

    # Tier 1 has its own reference block, produced by --hess at exactly this
    # geometry. The top-level `vibrations` block came from --ohess, which relaxes
    # the geometry further before building the Hessian, so its IR intensities do
    # not correspond to --hess here.
    if tier == 1 and "tier1_hess_at_optimized_geometry" in fixture:
        block = fixture["tier1_hess_at_optimized_geometry"]
        reference_energy = block["total_energy_hartree"]
        ref_vibrations = block
        ref_hessian = block["hessian_invariants"]
    else:
        reference_energy = fixture["energies_hartree"]["total_energy"]
        ref_vibrations = fixture["vibrations"]
        ref_hessian = fixture.get("hessian_invariants", {})

    failures = []
    limit = TIER1["energy_abs_eh"] if tier == 1 else TIER2["energy_abs_eh"]
    if abs(energy - reference_energy) > limit:
        failures.append(f"energy {energy:.12f} vs {reference_energy:.12f} "
                        f"(|d|={abs(energy - reference_energy):.3e} > {limit:.0e} Eh)")

    freqs, ints = parse_vibspectrum(os.path.join(workdir, "vibspectrum"))
    ref_freqs = sorted(ref_vibrations["frequencies"])
    ref_ints = [i for _, i in sorted(zip(ref_vibrations["frequencies"],
                                         ref_vibrations["ir_intensities"]),
                                     key=lambda t: t[0])]

    if len(freqs) != len(ref_freqs):
        failures.append(f"mode count {len(freqs)} vs {len(ref_freqs)}")
        return failures

    n_imaginary = sum(1 for f in freqs if f < 0.0)
    if n_imaginary != ref_vibrations["n_imaginary"]:
        failures.append(f"imaginary modes {n_imaginary} vs {ref_vibrations['n_imaginary']}")

    worst_freq = (0.0, -1)
    for index, (got, want) in enumerate(zip(freqs, ref_freqs)):
        delta = abs(got - want)
        if delta > worst_freq[0]:
            worst_freq = (delta, index)
        if tier == 1:
            allowed = TIER1["freq_abs_cm1"]
        else:
            allowed = (TIER2["freq_abs_cm1_soft"] if want < TIER2["freq_soft_cutoff"]
                       else TIER2["freq_abs_cm1_stiff"])
        if delta > allowed:
            failures.append(f"frequency[{index}] {got:.2f} vs {want:.2f} "
                            f"(|d|={delta:.2f} > {allowed} cm^-1)")

    strong = TIER1["intensity_strong_threshold"] if tier == 1 else TIER2["intensity_strong_threshold"]
    rel_limit = TIER1["intensity_rel_above"] if tier == 1 else TIER2["intensity_rel_above"]
    for index, (got, want) in enumerate(zip(ints, ref_ints)):
        if want > strong:
            rel = abs(got - want) / want
            if rel > rel_limit:
                failures.append(f"intensity[{index}] {got:.5f} vs {want:.5f} "
                                f"(rel={rel:.3e} > {rel_limit})")
        elif tier == 1 and abs(got - want) > TIER1["intensity_abs_below_km_mol"]:
            failures.append(f"intensity[{index}] {got:.5f} vs {want:.5f} "
                            f"(|d|={abs(got - want):.3e} > {TIER1['intensity_abs_below_km_mol']} km/mol)")

    hessian_path = os.path.join(workdir, "hessian")
    if tier == 1 and os.path.exists(hessian_path) and ref_hessian.get("valid"):
        got_invariants = hessian_invariants(hessian_path, n_atoms)
        for key in ("frobenius_norm", "trace"):
            want = ref_hessian[key]
            got = got_invariants[key]
            scale = abs(want) if abs(want) > 1e-12 else 1.0
            rel = abs(got - want) / scale
            if rel > TIER1["hessian_invariant_rel"]:
                failures.append(f"hessian {key} {got:.10f} vs {want:.10f} "
                                f"(rel={rel:.3e} > {TIER1['hessian_invariant_rel']:.0e})")

    print(f"  {name:<13} modes={len(freqs):<4} dE={abs(energy - reference_energy):.2e} Eh  "
          f"max df={worst_freq[0]:.3f} cm^-1")
    return failures


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("xtb", help="path to the xtb binary (or a wrapper script) to validate")
    parser.add_argument("--tier", type=int, choices=(1, 2), default=1)
    parser.add_argument("--only", nargs="*", default=None, help="molecule names to check")
    parser.add_argument("--scratch", default="/tmp/xtb-validate")
    args = parser.parse_args()

    index = json.load(open(os.path.join(FIXTURES, "index.json")))
    names = [m["name"] for m in index["molecules"]]
    if args.only:
        names = [n for n in names if n in set(args.only)]

    print(f"validating {args.xtb} against {len(names)} fixtures, tier {args.tier}")
    failed = {}
    skipped = []
    for name in names:
        fixture = json.load(open(os.path.join(FIXTURES, name + ".json")))
        if args.tier == 2 and not fixture.get("validation", {}).get(
                "tier2_single_ohess_reaches_minimum", True):
            skipped.append(name)
            print(f"  {name:<13} SKIP - a single --ohess from the raw geometry lands on a "
                  f"saddle point (see fixture.validation.note)")
            continue
        problems = check(fixture, args.xtb, args.tier, args.scratch)
        if problems:
            failed[name] = problems

    print()
    checked = len(names) - len(skipped)
    if not failed:
        extra = f" ({len(skipped)} skipped)" if skipped else ""
        print(f"PASS: {checked}/{checked} molecules within tier-{args.tier} tolerances{extra}")
        return 0
    for name, problems in failed.items():
        print(f"FAIL {name}: {len(problems)} violation(s)")
        for p in problems[:6]:
            print(f"    {p}")
        if len(problems) > 6:
            print(f"    ... and {len(problems) - 6} more")
    print(f"\nFAIL: {len(failed)}/{checked} molecules outside tier-{args.tier} tolerances")
    return 1


if __name__ == "__main__":
    sys.exit(main())
