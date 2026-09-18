# 16 — The server-side IR service, as it actually behaves today

All measurements below were taken live against `https://ir.cheminfo.org/v1` on
2026-08-29, and cross-checked against the source at
[cheminfo-py/xtbservice](https://github.com/cheminfo-py/xtbservice) (`main`,
last pushed 2024-05-13).

## 1. Status and endpoints

The service is **up**. `GET /v1/openapi.json` serves an OpenAPI 3.0.2 document
titled "XTB webservice". Swagger UI is at `/v1/docs`. There are exactly four
operations:

| Method | Path | Parameters | Returns |
|---|---|---|---|
| GET | `/v1/app_version` | — | `{"app_version": "0+unknown"}` |
| GET | `/v1/ir` | `smiles` (required), `method` (default `GFNFF`) | `IRResult` |
| POST | `/v1/ir` | body `{smiles?, molFile?, method?}` | `IRResult` |
| POST | `/v1/conformers` | body `{smiles?, molFile?, forceField='uff', rmsdThreshold=0.5, maxConformers=1}` | `{conformers: [{molFile, energy}]}` |

`method` is one of `GFNFF`, `GFN1xTB`, `GFN2xTB`. Note there is **no GET for
`molFile`** — a molfile must go through POST.

`app_version` reports `0+unknown`, i.e. the deployed image was built without git
metadata. There is no way to tell which commit is running.

## 2. The response shape is not what the OpenAPI says

This is the single most important finding for a client author.

### `wavenumbers` / `intensities` are a pre-folded spectrum, not per-mode arrays

The OpenAPI describes `wavenumbers` as "List of wavenumbers in cm^-1" and
`intensities` as "List of IR intensities". A reader naturally expects one entry
per normal mode. They are actually a **fixed 10001-point grid spanning
0–4000 cm⁻¹ in 0.4 cm⁻¹ steps**, identical for every molecule:

```
GRID: n= 10001 first 0 last 4000 step 0.4
max step deviation 3.638200851696638e-13
```

Water — a 3-atom molecule with 3 vibrations — returns 10001-element arrays and a
222 KB response. Per-mode values live in `modes[]`.

### `modes` contains all 3N modes, including translations and rotations

| molecule | atoms | `modes.length` | `modeType === 'vibration'` |
|---|---|---|---|
| water | 3 | 9 | 3 |
| ethanol | 9 | 27 | 21 |
| benzene | 12 | 36 | 30 |
| caffeine | 24 | 72 | 66 |

`modeType` (`translation` / `rotation` / `vibration`) is the **reliable filter**,
and it yields exactly 3N−6 in every case measured. The service itself folds the
spectrum from `modeType === 'vibration'` only.

`modes[].number` is the raw Hessian eigenvector index and is **not** the array
position — for water the array order is `3, 2, 1, 0, 4, 5, 6, 7, 8`.

### Undocumented mode fields

Every mode carries six fields absent from the published schema:
`wavenumber`, `modeType`, `mostContributingBonds`, `centerOfMassDisplacement`,
`totalChangeOfMomentOfInteria` (the service misspells "Inertia"), and
`displacementAlignment`. The schema also names `mostDisplaceAtoms`; the real
field is `mostDisplacedAtoms`.

### `zeroPointEnergy` is in eV, not "a.u."

The schema says "Zero point energy in a.u.". It is **eV**, and it is
`0.5 × Σ(non-imaginary mode wavenumbers) × ase.units.invcm` over *all* modes —
including the spurious rotations and translations. Verified to six decimals on
four molecules:

```
water     reported ZPE = 0.580895
   0.5*sum(non-imaginary) in eV = 0.580895  <-- match
   0.5*sum(vibration only) eV  = 0.547620
ethanol   reported ZPE = 2.126795
   0.5*sum(non-imaginary) in eV = 2.126795  <-- match
benzene   reported ZPE = 2.654053
   0.5*sum(non-imaginary) in eV = 2.654053  <-- match
caffeine  reported ZPE = 4.954612
   0.5*sum(non-imaginary) in eV = 4.954612  <-- match
```

For water the contamination is a **6% error** (0.5809 eV reported vs 0.5476 eV
over the three genuine vibrations). A client should recompute it.

### The imaginary-frequency flags are effectively meaningless

`hasImaginaryFrequency` was `true` for water, ethanol **and** benzene — all
well-converged molecules — because the near-zero translation modes get flagged.
Water's payload even reports `hasLargeImaginaryFrequency: true` alongside a
mode labelled `translation` at 526.9 cm⁻¹. Recompute both flags over
`modeType === 'vibration'` instead.

## 3. The folding is exactly reproducible client-side

`fold()` in `ir.py` is ASE's: Gaussian, `width = 4` cm⁻¹ FWHM,
`sigma = width / (2·sqrt(2·ln2))`, `normalize=False` (so peak height equals mode
intensity), `npts = int((end-start)/width*10 + 1) = 10001`.

Reimplementing that in TypeScript and refolding the server's own `modes[]`
reproduces its `intensities` array **to machine epsilon**:

```
water     npts 10001 | max |Δintensity| = 2.776e-17 | rel err = 8.86e-18
ethanol   npts 10001 | max |Δintensity| = 4.441e-16 | rel err = 1.34e-16
benzene   npts 10001 | max |Δintensity| = 5.551e-17 | rel err = 9.38e-18
caffeine  npts 10001 | max |Δintensity| = 3.553e-15 | rel err = 1.48e-16
```

**This is the key enabler for A/B comparison**: an occjs engine only has to
produce `(wavenumber, intensity)` pairs, and the identical folding function puts
both engines on a bit-identical grid.

`spectrum-generator`'s `generateSpectrum` was evaluated for this and rejected: it
ignores the per-peak `fwhm` field, leaving the peak flanks off by ~16% of peak
height regardless of the width requested (error was invariant across
`fwhm` 2.5→4.0 and `factor` 1→50).

## 4. CORS: wide open, no proxy required

This was the make-or-break question for a browser app. The answer is that a
browser on any origin can call the service directly.

```
=== GET with Origin, Accept: application/json ===
HTTP/2 200
access-control-allow-credentials: true
access-control-allow-origin: *

=== POST preflight (Origin, Request-Method: POST, Request-Headers: content-type,accept) ===
HTTP/2 200
access-control-allow-headers: content-type,accept
access-control-allow-methods: DELETE, GET, OPTIONS, PATCH, POST, PUT
access-control-allow-origin: *
access-control-max-age: 600
```

Matching the source: `CORSMiddleware(allow_origins=["*"], allow_credentials=True,
allow_methods=["*"], allow_headers=["*"])`.

**One trap.** The service sends `Access-Control-Allow-Credentials: true`
*together with* `Access-Control-Allow-Origin: *`. Browsers reject a credentialed
request against a wildcard origin, so the client must never send
`credentials: 'include'`. Set `credentials: 'omit'` explicitly rather than
relying on the default.

A GET carrying only `Accept: application/json` is a CORS-simple request and
skips the preflight entirely; the POST path costs one extra round trip, cached
for 600 s.

A Vite dev proxy is therefore **optional**. One is included in the deliverable
for the case where upstream tightens CORS, or where same-origin dev requests are
wanted.

## 5. Limits and failure modes

Configuration from `settings.py` / `.env`:

```python
IMAGINARY_FREQ_THRESHOLD = 10   # cm^-1
MAX_ATOMS_XTB = 60
MAX_ATOMS_FF  = 100
TIMEOUT       = 100             # .env overrides to 30
WORKERS       = 1
OMP_NUM_THREADS = 1,1
```

### The atom limit counts heavy atoms, and it does not work

`smiles2ase` calls `check_max_atoms(mol, max_atoms)` on the result of
`Chem.MolFromSmiles(smiles)` — **before** `Chem.AddHs`. So the limit counts
*heavy atoms only* on the SMILES path. `molfile2ase` parses with
`removeHs=False` and so counts *all* atoms. The same nominal limit means two
different things depending on which endpoint is used.

Worse, the documented `422` is not reachable in practice. Every oversize request
tested hung until **nginx returned a 504 after 60 s**, with an **HTML** body:

```
### C30 alkane (30 heavy / 92 total atoms), GFN2xTB
<html><head><title>504 Gateway Time-out</title></head>...  [504 t=60.035533]

### 61 heavy atoms, GFN2xTB (limit 60)
<html><head><title>504 Gateway Time-out</title></head>...  [504 t=60.035199]

### 101 heavy atoms, GFNFF (limit 100)
<html><head><title>504 Gateway Time-out</title></head>...  [504 t=60.021782]
```

The `TooLargeError → 422` path is defeated by
`@wrapt_timeout_decorator.timeout(TIMEOUT, use_signals=False)`, which runs the
work in a separate process where the custom exception type does not survive back
to the `except TooLargeError` handler. **A client must treat 504-with-HTML as the
"too big" signal** and must not call `response.json()` on an error body.

### Error taxonomy, measured

| Condition | Status | Body | Content-Type |
|---|---|---|---|
| missing `smiles` | 422 | `{"detail":[{"loc":["query","smiles"],"msg":"field required",...}]}` | JSON |
| invalid SMILES (`XYZ123`) | 500 | `Internal Server Error` | text/plain |
| unknown `method` | 500 | `Internal Server Error` | text/plain |
| empty `smiles` | 500 | `Internal Server Error` | text/plain |
| too large / too slow | 504 | nginx HTML page | text/html |

There is no structured error for a bad SMILES — just an opaque 500. The app must
validate SMILES client-side (OCL) before calling.

### No rate limiting, but a single worker — and head-of-line blocking

No `429`, no rate-limit headers, no evidence of throttling. But `WORKERS=1` and
`OMP_NUM_THREADS=1`, so the service processes **one calculation at a time**.
After the oversize requests above were fired, a normally-instant cached ethanol
request took **9.0 s**, then dropped back to 0.2 s once the queue drained:

```
try1: http=200 t=9.018415s
try2: http=200 t=0.285834s
try3: http=200 t=0.208780s
```

**The A/B tool must issue server requests strictly sequentially** (concurrency 1)
or it will both distort its own timings and degrade the shared service for
everyone else.

### Caching

`diskcache`, 1 GB, keyed on `md5(smiles + method)` (and separately on molfile and
on the post-optimization geometry). Cache hits return in ~0.2 s. There is no
cache-busting parameter, and **no HTTP cache headers at all** — no `ETag`, no
`Cache-Control`. Repeat timings therefore measure the server's disk cache, not
computation. Any honest benchmark must use a SMILES spelling the server has not
seen.

Note a latent bug in `optimize.py`: `opt_cache.set(this_hash, result, ...)` is
called while `result` is still `None`, one line before it is assigned. The
optimization cache therefore only ever stores `None`; only the outer
`ir_from_smiles_cache` is effective.

### Submitted geometry is discarded

`molfile2ase` calls `embed_conformer(mol)`, which runs a full RDKit
ETKDG conformer generation and **throws away the coordinates in the submitted
molfile**. A POST with a molfile controls atom ordering and connectivity but
*not* geometry. Confirmed live: an optimized-ethanol molfile returned wavenumbers
identical to `smiles=CCO` to every printed digit.

**Consequence for A/B**: you cannot pin a shared starting geometry across the two
engines. The server always re-embeds and re-optimizes (LBFGS, `fmax=5e-6`,
`maxiter=100`). Any comparison is between two independently converged
geometries, so exact agreement should not be expected — only agreement to within
the convergence tolerance of both.

## 6. Timing

Measured wall-clock, GFN2xTB, sequential. "Cold" uses a SMILES spelling the
server had not cached.

| molecule | atoms | vibrations (3N−6) | cold | cached |
|---|---|---|---|---|
| methanol | 6 | 12 | 1.43 s | 0.151 s |
| acetonitrile | 6 | 12 | 1.30 s | 0.143 s |
| acetone | 10 | 24 | 2.29 s | 0.155 s |
| phenol | 13 | 33 | 2.74 s | 0.164 s |
| toluene | 15 | 39 | 3.38 s | 0.185 s |
| naphthalene | 18 | 48 | 4.00 s | 0.176 s |
| aspirin | 21 | 57 | 6.09 s | 0.184 s |
| ibuprofen | 33 | 93 | 13.60 s | 0.219 s |

Cold cost grows roughly as N^1.6 over this range (6 atoms 1.43 s → 33 atoms
13.60 s). Extrapolating, the 60 s proxy ceiling lands somewhere around 70–80
atoms — i.e. the timeout, not `MAX_ATOMS`, is what actually bounds the service.
A cached response is ~0.15–0.22 s regardless of size, which is network latency
plus JSON serialization of the 10001-point grid.

For reference, ethanol across methods on a cold cache: GFNFF 0.18 s,
GFN2xTB 1.02 s, GFN1xTB 2.31 s. Caffeine (24 atoms) took 8.5 s cold.

The practical ceiling is the **nginx 60 s proxy timeout**, which is reached well
before either nominal atom limit.

## 7. The pipeline-workers `xtb-vibrational` worker

[cheminfo-py/pipeline-workers](https://github.com/cheminfo-py/pipeline-workers)
(public, last pushed 2026-03-20) contains four workers; `xtb-vibrational` is the
2026 successor to xtbservice's IR path.

### It is not reachable over HTTP

The worker is an **outbound SSE client**, not a server. `pipeline_worker/client.py`
opens an SSE connection to `SERVER_URL`, authenticates with a `TOKEN`, receives
tasks, and POSTs results back. `compose.yaml` publishes **no ports** for any
worker. There is no HTTP surface to call.

The orchestrator, `cheminfo/pipeline`, is **private** (the GitHub API returns
`Not Found`), and `pipeline.cheminfo.org` answers with a `302` to `/app/`.

**Conclusion: the browser cannot reach the xtbVibrational worker.** The only
A/B target available to the app today is `ir.cheminfo.org/v1`.

### Its output contract is identical to xtbservice

`_run_vibrational` returns exactly the same eleven keys, in the same units, with
the same folding function (the file's own comment says it matches xtbservice's
`fold()` "exactly", and it uses the same ASE `Infrared` + `PlaczekStatic` /
`BondPolarizability` stack rather than the xtb CLI). So the normalization written
for xtbservice will work unchanged if the worker is ever exposed.

Differences worth recording:

| | xtbservice | xtbVibrational worker |
|---|---|---|
| input | `smiles` or `molFile` | `{"molfile": ...}` only |
| geometry | re-embedded and optimized internally | expects an **already optimized** molfile from the upstream `xtbOptimization` worker; does not optimize |
| parameters | `method` | `{method, charge, multiplicity}` — but `charge` and `multiplicity` are documented and then **never passed** to `_run_vibrational`, so they are silently ignored |
| default method | `GFNFF` | `GFNFF` (though `example.py` passes `GFN2-xTB`, hyphenated — a different spelling from the service's `GFN2xTB`) |
| total energy | not returned | not returned (it comes from the upstream optimization step) |
| atom limit | 60 / 100 | none |
| timeout | 30 s app / 60 s proxy | none; bounded by the pipeline server |
| Raman | yes, may be null | yes, may be null |
| `mostRelevantModesOfAtoms` / `...OfBonds` | yes | yes, same construction |

The worker runs the Hessian in a subprocess specifically so "a Fortran crash in
xtb does not take down the main worker process" — a useful signal about how
often xtb aborts on this workload.

## 8. What this means for the browser app

1. **Call `ir.cheminfo.org/v1` directly.** CORS allows it; no proxy needed.
   Send `credentials: 'omit'`.
2. **Ignore the top-level `wavenumbers`/`intensities`** except for display of the
   server's own curve; derive everything from `modes[]` filtered to
   `modeType === 'vibration'`.
3. **Recompute ZPE and the imaginary flags.** The server's are contaminated.
4. **Treat 504-with-HTML as "too large".** Never `.json()` an error body.
5. **Serialize all server requests.** One worker, no rate limiting, easy to
   starve.
6. **Do not expect geometry parity.** The server re-embeds from SMILES no matter
   what you send it.
7. **Fold occjs output with the same ASE convention** to land on a bit-identical
   grid; the comparison is then well-posed.
8. The xtbVibrational worker is not an option from a browser and can be ignored
   until someone puts an HTTP front end on the pipeline.
