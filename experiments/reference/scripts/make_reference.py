#!/usr/bin/env python3
"""Produce the xtb GFN2-xTB IR reference data set.

For each molecule: xtb --opt (pre-optimization), then xtb --ohess on the
optimized geometry. Everything is parsed into one self-describing JSON file
per molecule.
"""

import json
import math
import os
import re
import shutil
import subprocess
import sys
import time

XTB = os.environ["XTB_BIN"]
BUILD_LABEL = os.environ.get("BUILD_LABEL", "unknown")
OUTDIR = os.environ["REF_OUTDIR"]
GEOMDIR = os.environ.get("GEOM_DIR", "/out/geom")
MOLTSV = os.environ.get("MOL_TSV", "/out/molecules.tsv")
WORKROOT = os.environ.get("WORK_ROOT", "/tmp/refwork")
ONLY = os.environ.get("ONLY_MOLECULES", "").split() or None

WALL_RE = re.compile(
    r"\*\s+wall-time:\s+(\d+)\s*d,\s*(\d+)\s*h,\s*(\d+)\s*min,\s*([\d.]+)\s*sec"
)


def sh(cmd, cwd, logpath):
    t0 = time.monotonic()
    with open(logpath, "w") as fh:
        proc = subprocess.run(cmd, cwd=cwd, stdout=fh, stderr=subprocess.STDOUT)
    return proc.returncode, time.monotonic() - t0


def parse_timings(text):
    """xtb prints a labelled wall-time block at the end of every run."""
    out = {}
    lines = text.splitlines()
    label = None
    for line in lines:
        stripped = line.strip()
        if stripped.endswith(":") and not stripped.startswith("*"):
            label = stripped[:-1].strip()
            continue
        m = WALL_RE.search(line)
        if m and label:
            d, h, mi, s = m.groups()
            out[label] = (
                int(d) * 86400 + int(h) * 3600 + int(mi) * 60 + float(s)
            )
            label = None
    return out


def grab(text, pattern, cast=float):
    m = re.search(pattern, text)
    return cast(m.group(1)) if m else None


def parse_vibspectrum(path):
    freqs, ints = [], []
    with open(path) as fh:
        for line in fh:
            line = line.rstrip("\n")
            if line.startswith("$") or line.startswith("#"):
                continue
            parts = line.split()
            if not parts or not parts[0].isdigit():
                continue
            # "  N  [a]  freq  intensity  [selection rules]"
            nums = []
            for p in parts[1:]:
                try:
                    nums.append(float(p))
                except ValueError:
                    pass
            if len(nums) >= 2:
                freqs.append(nums[0])
                ints.append(nums[1])
            elif len(nums) == 1:  # translation/rotation row
                freqs.append(nums[0])
                ints.append(0.0)
    return freqs, ints


def parse_xyz(path):
    lines = open(path).read().splitlines()
    n = int(lines[0].split()[0])
    comment = lines[1]
    atoms = []
    for line in lines[2 : 2 + n]:
        p = line.split()
        atoms.append(
            {"symbol": p[0], "x": float(p[1]), "y": float(p[2]), "z": float(p[3])}
        )
    return {"n_atoms": n, "comment": comment, "atoms": atoms}


def hessian_invariants(path, n_atoms):
    vals = []
    with open(path) as fh:
        for line in fh:
            if line.startswith("$"):
                continue
            for p in line.split():
                try:
                    vals.append(float(p))
                except ValueError:
                    pass
    n3 = 3 * n_atoms
    if len(vals) != n3 * n3:
        return {"n_elements": len(vals), "expected": n3 * n3, "valid": False}
    frob = 0.0
    trace = 0.0
    for i in range(n3 * n3):
        v = vals[i]
        frob += v * v
    for i in range(n3):
        trace += vals[i * n3 + i]
    return {
        "dimension": n3,
        "frobenius_norm": math.sqrt(frob),
        "trace": trace,
        "valid": True,
    }


def parse_dipole(text):
    m = re.search(
        r"molecular dipole:.*?full:\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)",
        text,
        re.S,
    )
    if not m:
        return None
    return {
        "x": float(m.group(1)),
        "y": float(m.group(2)),
        "z": float(m.group(3)),
        "total_debye": float(m.group(4)),
    }



def read_mode1(g98):
    """Lowest normal mode (frequency, per-atom displacement) from g98.out."""
    lines = open(g98).read().splitlines()
    for i, line in enumerate(lines):
        if "Frequencies --" in line:
            freq = float(line.split("--")[1].split()[0])
            start = None
            for j in range(i, min(i + 10, len(lines))):
                if lines[j].strip().startswith("Atom"):
                    start = j + 1
                    break
            disp = []
            k = start
            while k < len(lines) and len(lines[k].split()) >= 5:
                p = lines[k].split()
                try:
                    disp.append((float(p[2]), float(p[3]), float(p[4])))
                except ValueError:
                    break
                k += 1
            return freq, disp
    return None, None


def read_xyz_atoms(path):
    lines = open(path).read().splitlines()
    n = int(lines[0].split()[0])
    out = []
    for line in lines[2 : 2 + n]:
        p = line.split()
        out.append((p[0], float(p[1]), float(p[2]), float(p[3])))
    return out


def write_xyz_atoms(path, atoms, comment=""):
    with open(path, "w") as fh:
        fh.write("%d\n%s\n" % (len(atoms), comment))
        for s, x, y, z in atoms:
            fh.write("%-3s %20.14f %20.14f %20.14f\n" % (s, x, y, z))


def lowest_vib_freq(vibspectrum):
    freqs, _ = parse_vibspectrum(vibspectrum)
    real = [f for f in freqs if abs(f) > 0.01]
    return min(real) if real else None


def escape_saddle(work, name, amplitudes=(0.6, 1.0, 1.5)):
    """Displace along the imaginary mode far enough to leave a shallow saddle.

    xtb's own xtbhess.xyz step is too small for a near-free methyl rotor: the
    re-optimization falls straight back onto the saddle. Scanning a larger
    amplitude in both directions and re-optimizing at vtight finds the real
    minimum. Returns the path of the best geometry, or None.
    """
    g98 = os.path.join(work, "g98.out")
    if not os.path.exists(g98):
        return None
    freq, disp = read_mode1(g98)
    if not disp:
        return None
    atoms = read_xyz_atoms(os.path.join(work, "final.xyz"))
    if len(atoms) != len(disp):
        return None
    best = None
    for amp in amplitudes:
        for sign in (1, -1):
            tag = "esc_%s_%s" % (amp, "p" if sign > 0 else "m")
            trial = [
                (s, x + sign * amp * d[0], y + sign * amp * d[1],
                 z + sign * amp * d[2])
                for (s, x, y, z), d in zip(atoms, disp)
            ]
            sub = os.path.join(work, tag)
            shutil.rmtree(sub, ignore_errors=True)
            os.makedirs(sub)
            write_xyz_atoms(os.path.join(sub, "in.xyz"), trial, "displaced")
            rc, _ = sh(
                [XTB, "in.xyz", "--ohess", "vtight", "--gfn", "2",
                 "--chrg", "0", "--uhf", "0"],
                sub, os.path.join(sub, "run.out"),
            )
            if rc != 0:
                continue
            text = open(os.path.join(sub, "run.out")).read()
            energy = grab(text, r"TOTAL ENERGY\s+(-?[\d.]+)\s+Eh")
            lo = lowest_vib_freq(os.path.join(sub, "vibspectrum"))
            print("[%s]   %s: E=%s lowest=%s" % (name, tag, energy, lo), flush=True)
            if lo is not None and lo > 0 and energy is not None:
                if best is None or energy < best[1]:
                    best = (os.path.join(sub, "xtbopt.xyz"), energy)
    return best[0] if best else None


def main():
    molecules = []
    for line in open(MOLTSV):
        line = line.rstrip("\n")
        if not line.strip():
            continue
        name, smiles, nat, formula = line.split("\t")
        if ONLY and name not in ONLY:
            continue
        molecules.append((name, smiles, int(nat), formula))

    os.makedirs(OUTDIR, exist_ok=True)
    index = []

    for name, smiles, nat, formula in molecules:
        work = os.path.join(WORKROOT, BUILD_LABEL, name)
        shutil.rmtree(work, ignore_errors=True)
        os.makedirs(work)
        src = os.path.join(GEOMDIR, name + ".xyz")
        shutil.copy(src, os.path.join(work, "input.xyz"))

        print(f"[{name}] n={nat} opt...", flush=True)
        opt_cmd = [XTB, "input.xyz", "--opt", "--gfn", "2", "--chrg", "0", "--uhf", "0"]
        rc_opt, t_opt = sh(opt_cmd, work, os.path.join(work, "opt.out"))
        if rc_opt != 0 or not os.path.exists(os.path.join(work, "xtbopt.xyz")):
            print(f"[{name}] OPT FAILED rc={rc_opt}", flush=True)
            continue
        shutil.copy(
            os.path.join(work, "xtbopt.xyz"), os.path.join(work, "optimized.xyz")
        )
        opt_text = open(os.path.join(work, "opt.out")).read()

        # clean restart/state files so the hessian run starts from scratch
        for f in ("xtbrestart", "xtbtopo.mol", "xtbopt.log", "charges", "wbo"):
            p = os.path.join(work, f)
            if os.path.exists(p):
                os.remove(p)

        # --ohess, then follow any imaginary mode downhill until a true minimum.
        # xtb writes the geometry distorted along the imaginary mode to
        # xtbhess.xyz; restarting from it escapes methyl-torsion saddle points.
        max_rounds = int(os.environ.get("MAX_HESS_ROUNDS", "4"))
        t_hess = 0.0
        rounds = 0
        geom_in = "optimized.xyz"
        hess_cmd = None
        while True:
            rounds += 1
            print(f"[{name}] ohess (round {rounds})...", flush=True)
            hess_cmd = [
                XTB, geom_in, "--ohess", "--gfn", "2", "--chrg", "0", "--uhf", "0",
            ]
            rc_h, dt = sh(hess_cmd, work, os.path.join(work, "ohess.out"))
            t_hess += dt
            if rc_h != 0:
                break
            text = open(os.path.join(work, "ohess.out")).read()
            freqs, ints = parse_vibspectrum(os.path.join(work, "vibspectrum"))
            vib_idx = [i for i, f in enumerate(freqs) if abs(f) > 0.01]
            vib_freqs = [freqs[i] for i in vib_idx]
            vib_ints = [ints[i] for i in vib_idx]
            n_imag = sum(1 for f in vib_freqs if f < 0.0)
            if n_imag == 0 or rounds >= max_rounds:
                break
            distorted = os.path.join(work, "xtbhess.xyz")
            if not os.path.exists(distorted):
                break
            print(
                f"[{name}]   {n_imag} imaginary mode(s), lowest={vib_freqs[0]:.2f}"
                f" cm^-1 -> distorting along it and re-optimizing",
                flush=True,
            )
            shutil.copy(distorted, os.path.join(work, f"restart{rounds}.xyz"))
            geom_in = f"restart{rounds}.xyz"
            for f in ("xtbrestart", "xtbtopo.mol", "xtbopt.log", "xtbhess.xyz"):
                p = os.path.join(work, f)
                if os.path.exists(p):
                    os.remove(p)
        if rc_h != 0:
            print(f"[{name}] OHESS FAILED rc={rc_h}", flush=True)
            continue
        # the final --ohess re-optimized the geometry; that is the reference one
        if os.path.exists(os.path.join(work, "xtbopt.xyz")):
            shutil.copy(
                os.path.join(work, "xtbopt.xyz"),
                os.path.join(work, "final.xyz"),
            )
        else:
            shutil.copy(
                os.path.join(work, "optimized.xyz"), os.path.join(work, "final.xyz")
            )

        escaped_rounds = 0
        if n_imag > 0:
            print(
                f"[{name}] still {n_imag} imaginary after {rounds} rounds; "
                f"scanning larger displacements along the mode",
                flush=True,
            )
            better = escape_saddle(work, name)
            if better:
                shutil.copy(better, os.path.join(work, "escaped.xyz"))
                escaped_rounds = 1
                rc_h, dt = sh(
                    [XTB, "escaped.xyz", "--ohess", "--gfn", "2",
                     "--chrg", "0", "--uhf", "0"],
                    work, os.path.join(work, "ohess.out"),
                )
                t_hess += dt
                text = open(os.path.join(work, "ohess.out")).read()
                freqs, ints = parse_vibspectrum(os.path.join(work, "vibspectrum"))
                vib_idx = [i for i, f in enumerate(freqs) if abs(f) > 0.01]
                vib_freqs = [freqs[i] for i in vib_idx]
                vib_ints = [ints[i] for i in vib_idx]
                n_imag = sum(1 for f in vib_freqs if f < 0.0)
                shutil.copy(
                    os.path.join(work, "xtbopt.xyz"), os.path.join(work, "final.xyz")
                )

        timings = parse_timings(text)
        version = grab(text, r"xtb version\s+(\S+)", str)

        record = {
            "schema": "xtb-wasm/ir-reference/1",
            "molecule": {
                "name": name,
                "formula": formula,
                "smiles": smiles,
                "n_atoms": nat,
                "charge": 0,
                "uhf": 0,
            },
            "provenance": {
                "xtb_version": version,
                "method": "GFN2-xTB",
                "build_label": BUILD_LABEL,
                "build_options": os.environ.get("BUILD_OPTIONS", ""),
                "geometry_source": (
                    "SMILES -> Open Babel --gen3d (obabel 3.1.1), then xtb --opt --gfn 2"
                ),
                "hessian_rounds": rounds,
                "saddle_escape_applied": bool(escaped_rounds),
                "hessian_rounds_note": (
                    "Number of --ohess rounds. >1 means the first Hessian had an "
                    "imaginary mode (a methyl-torsion saddle point); the geometry "
                    "was distorted along it (xtb's xtbhess.xyz) and re-optimized "
                    "until all modes are real."
                ),
                "environment": {
                    "OMP_NUM_THREADS": os.environ.get("OMP_NUM_THREADS"),
                    "lapack": os.environ.get("LAPACK_LABEL", "openblas"),
                    "host_arch": os.environ.get("HOST_ARCH", "aarch64"),
                    "container": os.environ.get("CONTAINER_IMAGE", "xtbnat:base"),
                },
                "commands": {
                    "preoptimization": " ".join(opt_cmd),
                    "hessian": " ".join(hess_cmd),
                },
            },
            "input_geometry_xyz": parse_xyz(src),
            "optimized_geometry_xyz": parse_xyz(os.path.join(work, "final.xyz")),
            "energies_hartree": {
                "total_energy": grab(text, r"TOTAL ENERGY\s+(-?[\d.]+)\s+Eh"),
                "total_enthalpy": grab(text, r"TOTAL ENTHALPY\s+(-?[\d.]+)\s+Eh"),
                "total_free_energy": grab(text, r"TOTAL FREE ENERGY\s+(-?[\d.]+)\s+Eh"),
                "gradient_norm": grab(text, r"GRADIENT NORM\s+(-?[\d.]+)"),
                "zero_point_energy": grab(text, r"zero point energy\s+(-?[\d.]+)\s+Eh"),
                "g_rrho_without_zpve": grab(
                    text, r"G\(RRHO\) w/o ZPVE\s+(-?[\d.]+)\s+Eh"
                ),
                "g_rrho_contribution": grab(
                    text, r"G\(RRHO\) contrib\.\s+(-?[\d.]+)\s+Eh"
                ),
            },
            "homo_lumo_gap_ev": grab(text, r"HOMO-LUMO GAP\s+(-?[\d.]+)\s+eV"),
            "dipole": parse_dipole(text),
            "vibrations": {
                "units": {"frequency": "cm^-1", "ir_intensity": "km/mol"},
                "n_modes_total": len(freqs),
                "n_vibrational_modes": len(vib_freqs),
                "n_imaginary": n_imag,
                "frequencies": vib_freqs,
                "ir_intensities": vib_ints,
                "all_modes_including_trans_rot": {
                    "frequencies": freqs,
                    "ir_intensities": ints,
                },
            },
            "hessian_invariants": hessian_invariants(
                os.path.join(work, "hessian"), nat
            ),
            "timings_seconds": {
                "preoptimization_wall": round(t_opt, 3),
                "ohess_wall": round(t_hess, 3),
                "xtb_internal": {k: v for k, v in timings.items()},
                "note": (
                    "preoptimization_wall/ohess_wall are external wall clock for the "
                    "two xtb invocations. xtb_internal is xtb's own breakdown of the "
                    "--ohess run; 'ANC optimizer' is the geometry relaxation and "
                    "'analytical hessian' is the 6N+1 finite-difference Hessian "
                    "(despite the label, xtb has no analytic Hessian)."
                ),
            },
        }

        path = os.path.join(OUTDIR, name + ".json")
        with open(path, "w") as fh:
            json.dump(record, fh, indent=2)
            fh.write("\n")
        index.append(
            {
                "name": name,
                "formula": formula,
                "n_atoms": nat,
                "file": name + ".json",
                "total_energy": record["energies_hartree"]["total_energy"],
                "n_vibrational_modes": len(vib_freqs),
                "n_imaginary": n_imag,
                "opt_wall_s": round(t_opt, 3),
                "ohess_wall_s": round(t_hess, 3),
                "hessian_wall_s": timings.get("analytical hessian"),
            }
        )
        print(
            f"[{name}] E={record['energies_hartree']['total_energy']} "
            f"modes={len(vib_freqs)} imag={n_imag} "
            f"opt={t_opt:.1f}s ohess={t_hess:.1f}s",
            flush=True,
        )

    with open(os.path.join(OUTDIR, "index.json"), "w") as fh:
        json.dump(
            {"schema": "xtb-wasm/ir-reference-index/1", "molecules": index},
            fh,
            indent=2,
        )
        fh.write("\n")
    print("wrote", len(index), "records to", OUTDIR)


if __name__ == "__main__":
    sys.exit(main())
