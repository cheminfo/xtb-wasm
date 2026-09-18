// Benchmark @peterspackman/occjs — OCC's C++17 GFN2-xTB reimplementation compiled
// to WebAssembly — on the SAME xtb-optimised geometries used for the native xtb
// reference, so the wasm/native ratio is measured on identical structures.
//
// This is an implementation-to-implementation comparison (OCC-wasm vs xtb-native),
// NOT a port-to-port one: OCC is an independent C++ rewrite of GFN2, not xtb
// compiled to wasm.
//
// All OCC diagnostic printing is suppressed through the emscripten print hooks;
// per-SCF-cycle output otherwise dominates the measured time.
import { loadOCC, moleculeFromXYZ } from '@peterspackman/occjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const MOLDIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'mol');
const names = process.argv.slice(2);
const doHess = process.env.HESS !== '0';
const reps = Number(process.env.REPS ?? 3);
const hessBudgetS = Number(process.env.HESS_BUDGET_S ?? 400);

const t0 = performance.now();
const M = await loadOCC({ env: { print: () => {}, printErr: () => {} } });
try {
  M.setLogLevel(M.LogLevel.OFF);
} catch {}
const loadMs = performance.now() - t0;
console.error(`# occjs load: ${loadMs.toFixed(0)} ms  node ${process.version}`);

const mb = (x) => (x / 1048576).toFixed(1);
const rows = [
  'molecule,natoms,stage,rep,ms,rss_mb,heap_used_mb,scf_iters,energy_hartree,nmodes,note',
];
rows.push(`,,load,1,${loadMs.toFixed(2)},${mb(process.memoryUsage().rss)},,,,,module-load`);

for (const n of names) {
  let xyz;
  try {
    xyz = readFileSync(join(MOLDIR, `${n}_opt.xyz`), 'utf8');
  } catch {
    console.error(`# MISSING ${n}_opt.xyz`);
    continue;
  }
  const mol = await moleculeFromXYZ(xyz);
  const calc = M.XtbCalculator.fromMolecule(mol);
  const nat = calc.numAtoms();

  let res;
  try {
    res = calc.singlePoint(); // warm-up: JIT + first allocation, not timed
  } catch (e) {
    console.error(`  sp   ${n} FAILED: ${e?.message ?? e}`);
    rows.push(`${n},${nat},sp,1,,,,,,,ERROR ${String(e?.message ?? e).replaceAll(',', ';')}`);
    continue;
  }

  let spBest = Infinity;
  for (let r = 1; r <= reps; r++) {
    const t = performance.now();
    res = calc.singlePoint();
    const ms = performance.now() - t;
    spBest = Math.min(spBest, ms);
    const mu = process.memoryUsage();
    rows.push(
      `${n},${nat},sp,${r},${ms.toFixed(3)},${mb(mu.rss)},${mb(mu.heapUsed)},${res.nIterations},${res.totalEnergy.toFixed(8)},,`,
    );
  }
  console.error(
    `  sp   ${n} N=${nat} best=${spBest.toFixed(1)}ms iters=${res.nIterations} E=${res.totalEnergy.toFixed(6)}`,
  );

  if (!doHess) continue;
  // A numerical Hessian is 6N single points; skip when the estimate blows the budget.
  const estS = (spBest * (6 * nat + 1)) / 1000;
  if (estS > hessBudgetS) {
    console.error(`  hess ${n} SKIPPED (estimate ${estS.toFixed(0)}s > budget ${hessBudgetS}s)`);
    rows.push(`${n},${nat},hess,1,,,,,,,SKIPPED est=${estS.toFixed(0)}s`);
    continue;
  }
  const hreps = estS > 20 ? 1 : Math.min(reps, 2);
  for (let r = 1; r <= hreps; r++) {
    const t = performance.now();
    let modes;
    try {
      modes = calc.vibrationalModes(0.005, true);
    } catch (e) {
      console.error(`  hess ${n} FAILED: ${e?.message ?? e}`);
      rows.push(`${n},${nat},hess,${r},,,,,,,ERROR ${String(e?.message ?? e).replaceAll(',', ';')}`);
      break;
    }
    const ms = performance.now() - t;
    const mu = process.memoryUsage();
    rows.push(
      `${n},${nat},hess,${r},${ms.toFixed(3)},${mb(mu.rss)},${mb(mu.heapUsed)},,,${modes.nModes()},`,
    );
    console.error(
      `  hess ${n} N=${nat} ${(ms / 1000).toFixed(2)}s nmodes=${modes.nModes()} rss=${mb(mu.rss)}MB  (est was ${estS.toFixed(1)}s)`,
    );
  }
}
writeFileSync(process.env.CSV_OUT ?? '/dev/stdout', `${rows.join('\n')}\n`);
