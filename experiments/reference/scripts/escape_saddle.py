#!/usr/bin/env python3
"""Escape a shallow saddle point that xtb's own xtbhess.xyz distortion cannot.

Reads the lowest (imaginary) normal mode from g98.out, displaces the geometry
along it by a configurable amplitude in both directions, re-optimizes each with
--opt vtight and keeps the lowest-energy structure that has no imaginary mode.
"""

import os
import re
import shutil
import subprocess
import sys

XTB = os.environ["XTB_BIN"]


def read_mode1(g98):
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


def read_xyz(path):
    lines = open(path).read().splitlines()
    n = int(lines[0].split()[0])
    atoms = []
    for line in lines[2 : 2 + n]:
        p = line.split()
        atoms.append((p[0], float(p[1]), float(p[2]), float(p[3])))
    return atoms


def write_xyz(path, atoms, comment=""):
    with open(path, "w") as fh:
        fh.write(f"{len(atoms)}\n{comment}\n")
        for s, x, y, z in atoms:
            fh.write(f"{s:<3s} {x:20.14f} {y:20.14f} {z:20.14f}\n")


def lowest_freq(vibspectrum):
    freqs = []
    for line in open(vibspectrum):
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
        if nums and abs(nums[0]) > 0.01:
            freqs.append(nums[0])
    return min(freqs) if freqs else None


def main():
    work = sys.argv[1]
    amplitudes = [float(a) for a in (sys.argv[2:] or ["0.6", "1.0", "1.5"])]
    freq, disp = read_mode1(os.path.join(work, "g98.out"))
    atoms = read_xyz(os.path.join(work, "final.xyz"))
    print(f"imaginary mode {freq} cm^-1, {len(disp)} displacement vectors")

    best = None
    for amp in amplitudes:
        for sign in (+1, -1):
            tag = f"esc_{amp}_{'p' if sign > 0 else 'm'}"
            trial = [
                (s, x + sign * amp * d[0], y + sign * amp * d[1], z + sign * amp * d[2])
                for (s, x, y, z), d in zip(atoms, disp)
            ]
            sub = os.path.join(work, tag)
            shutil.rmtree(sub, ignore_errors=True)
            os.makedirs(sub)
            write_xyz(os.path.join(sub, "in.xyz"), trial, f"displaced {sign*amp}")
            with open(os.path.join(sub, "run.out"), "w") as fh:
                rc = subprocess.run(
                    [XTB, "in.xyz", "--ohess", "vtight", "--gfn", "2",
                     "--chrg", "0", "--uhf", "0"],
                    cwd=sub, stdout=fh, stderr=subprocess.STDOUT,
                ).returncode
            if rc != 0:
                print(f"  {tag}: xtb failed")
                continue
            text = open(os.path.join(sub, "run.out")).read()
            m = re.search(r"TOTAL ENERGY\s+(-?[\d.]+)\s+Eh", text)
            energy = float(m.group(1)) if m else None
            lo = lowest_freq(os.path.join(sub, "vibspectrum"))
            print(f"  {tag}: E={energy} lowest={lo}")
            if lo is not None and lo > 0 and energy is not None:
                if best is None or energy < best[1]:
                    best = (sub, energy, lo)
    if best:
        print(f"BEST: {best[0]}  E={best[1]}  lowest={best[2]}")
    else:
        print("no imaginary-free structure found")


if __name__ == "__main__":
    sys.exit(main())
