## SUMMARY
Mechanically, running a cross-compiled test suite is a solved problem in both of xtb's build systems, and I verified it end-to-end on this machine: Meson's `exe_wrapper` (meson ships `cross/wasm32-emscripten.txt` with `exe_wrapper = 'node'` verbatim) and CTest's `CMAKE_CROSSCOMPILING_EMULATOR` (which `emcmake` sets to node automatically) both prepend a runtime to every test command. I built a C stand-in for xtb's `tester` and ran `meson test` green under (a) emcc + node, (b) wasi-sdk 34 + wasmtime 48, and `ctest` green under (c) emcmake + node. So the harness question is not the risk. The risk is entirely in the runtime facilities layer, and there the two targets diverge sharply. Emscripten+NODERAWFS+node supplies everything xtb's 35 meson / 41 ctest tests touch — argv, `getenv`, real host file I/O, `tmpfile`, exit codes, `signal()`, and even `system()` (emscripten lowers it to `node:child_process.spawnSync`, so Fortran's `execute_command_line` works under node and returns `-ENOSYS` in a browser). WASI does not: wasi-sdk 34's `libc.a` has no `mkstemp`, `tmpfile`, `system`, `fork`, `execl`, `signal` or `raise` at all, and I reproduced the hard failures — xtb's own `src/mctc/signal.c:16` does not even compile for wasm32-wasip1 ("call to undeclared function 'signal'"), and that file is on the critical path of every single unit test via `mctc_init` → `xtb_signal_handler`. Meson's `env:` (which carries `XTBPATH`, the thing 29 unit tests use to find parameter files) also silently fails to reach a WASI guest unless you edit the wrapper. Conclusion: emscripten + NODERAWFS + node is the only route where the unmodified suite can plausibly run; the remaining blocker is the Fortran runtime itself, which does exist for wasm32-unknown-emscripten (emscripten-forge's `libflang` 22.1.6 builds flang-rt from four out-of-tree patches) but ships with `FLANG_RT_INCLUDE_TESTS=OFF`, so its I/O layer is validated by exactly one `hello.f90` smoke test.

## BLOCKERS
None

## DETAILS
> Scope note: this study answers *how a wasm test suite would be executed*. Wherever the Fortran-to-wasm compiler itself is the subject, I stay at the level needed to judge executability and defer the rest to the toolchain study.

All demo artifacts are under `/private/tmp/claude-501/-Users-lpatiny-git-cheminfo-xtb-wasm/b4ef164a-9f01-47f3-82e3-bd6e64466d17/scratchpad/demo/`.

---

## 1. What "all the tests pass" actually means, mechanically

The suite is not 35 independent programs. It is **one binary, `tester`, that dispatches on `argv[1]`**, plus a handful of CLI invocations of `xtb` itself.

| | Meson | CTest |
|---|---|---|
| unit suites (via `tester <name>`) | 29 | 29 |
| argparser CLI tests | 4 (`--version`, `--help`, `--license`, no-args) | 3 |
| `Info` (reads 4 structure files) | 1 (skipped on Windows) | 1 |
| real SCF runs (`--coffee --strict --namespace testN`) | 0 | 6 |
| C API | 1 | 1 |
| **total** | **35** | **41** |

- `test/unit/meson.build:34-63` — the 28-name `tests` list; `:86-89` emits one `test()` per name plus `ptb`.
- `test/unit/meson.build:92-95` — argparser tests; the no-args one is `should_fail: true`, so **exit codes must be faithful**.
- `test/unit/meson.build:97-103` — `Info` passes four `assets/inputs/...` paths as argv, so **file paths must resolve inside the guest**.
- `test/unit/CMakeLists.txt:120-125` — the six extra CTest runs are real SCF calculations that write output into `test1/`…`test6/` namespaces.

Inside `tester`: **136 `new_unittest` registrations** and **558 `call check(...)` assertions**, with tolerances like `test/unit/test_gfn2.f90:73` `real(wp),parameter :: thr = 1.0e-7_wp` applied to total energies at `:140`. Upstream CI already runs this with a **120× timeout multiplier** (`.github/workflows/fortran-build.yml:56`).

The three runtime dependencies that matter, in order of danger:

1. **`XTBPATH` env var** — `xtb/meson.build:213-216` builds `xtbenv` with `xtbenv.set('XTBPATH', meson.current_source_dir())`; CMake mirrors it at `test/unit/CMakeLists.txt:94-98`. Three suites resolve parameter files through it: `test_gfn0.f90:117`, `test_gfn1.f90:806`, `test_peeq.f90:130`, all via `rdpath` (`src/mctc/systools.F90:66-101`, which probes with `inquire(file=..., exist=...)`) reading the variable at `systools.F90:145,166`.
2. **A Fortran scratch file** — `test/unit/test_gfn2.f90:607` `open(newunit=tmp_unit, Status="Scratch")`.
3. **`signal()`** — `test/unit/main.f90:57` calls `mctc_init`, which at `src/mctc/mctc_init.F90:52-53` installs SIGINT/SIGTERM handlers through `src/mctc/signal.c:16`. **This runs before any test does anything**, in all 29 suites.

---

## 2. Meson `exe_wrapper` — the mechanism, and a working run

The [Meson cross-compilation docs](https://mesonbuild.com/Cross-compilation.html) state it plainly:

> The `exe_wrapper` option defines a *wrapper command* that can be used to run executables for this host. […] Meson will automatically use the given wrapper when it needs to run host binaries. This happens e.g. when running the project's test suite.

The implementation is `mesonbuild/mtest.py:1537-1549` (prepend `exe_wrapper.get_command()` when `is_cross_built and needs_exe_wrapper`; hard-error if the wrapper is declared but not found) and `mtest.py:1814` (`env['MESON_EXE_WRAPPER'] = ...`). Auto-detection can be forced with `[properties] needs_exe_wrapper = true`.

**Meson ships an emscripten cross file already.** `mesonbuild/meson` → `cross/wasm32-emscripten.txt`, verbatim:

```ini
[binaries]
c = 'emcc'
cpp = 'em++'
ar = 'emar'
ranlib = 'emranlib'
exe_wrapper = 'node'

[host_machine]
system = 'emscripten'
cpu_family = 'wasm32'
cpu = 'wasm32'
endian = 'little'
```

(`cross/wasm64-emscripten.txt` is the same plus `-m64` args.) There is **no `fortran =` line** — that gap is the toolchain study's subject.

The `.js` naming that makes `node` work is `mesonbuild/build.py:2227-2228`:

```python
elif machine.system.startswith('wasm') or machine.system == 'emscripten':
    self.suffix = 'js'
```

Note this matches `emscripten` and `wasm*` but **not `wasi`** — a wasi cross build produces an extensionless file that is nonetheless a wasm module.

### Verified run (meson 1.12.0, emcc 5.0.7-git, node v26.0.0)

I wrote a C stand-in that reproduces `tester`'s contract — argv suite selection, `getenv("XTBPATH")`, opening a parameter file from that path, `tmpfile()`, `system()`, and exit codes:

```
$ meson test -C build-wasm --print-errorlogs
1/4 unit - wasmtestdemo:gfn2     OK              0.86s
2/4 wasmtestdemo:no arguments    EXPECTEDFAIL    0.82s   exit status 1
3/4 unit - wasmtestdemo:spawn    OK              0.88s
4/4 unit - wasmtestdemo:atomlist OK              1.06s

Ok: 3   Expected Fail: 1   Fail: 0
```

`build-wasm/meson-logs/testlog.txt:10` shows the composed command:

```
MALLOC_PERTURB_=5 XTBPATH=/…/demo … MESON_EXE_WRAPPER=/opt/homebrew/bin/node …
/opt/homebrew/bin/node /…/build-wasm/tester.js gfn2
```

and the stdout proving the facilities worked:

```
# Running suite 'gfn2'
# XTBPATH=/…/scratchpad/demo
# fopen(/…/demo/param_gfn2-xtb.txt) -> ok
# first line: # GFN2-xTB parameter file (stub)
# tmpfile() -> ok
# suite 'gfn2' PASSED
```

Cross file used (`demo/cross-emcc.ini`) — the shipped one plus two link settings:

```ini
[built-in options]
c_args      = ['-sNODERAWFS=1', '-sEXIT_RUNTIME=1']
c_link_args = ['-sNODERAWFS=1', '-sEXIT_RUNTIME=1']
```

**xtb-specific configure caveat:** meson would need the exe_wrapper for `.run()` compiler checks, but `grep -rn "\.run(" --include=meson.build .` over xtb finds none. LAPACK detection is link-only (`fc.links('external dsytrs; call dsytrs(); end', …)` at `meson/meson.build:169,191,193`), which meson performs without executing. So cross-configuration will not stall.

---

## 3. CTest `CMAKE_CROSSCOMPILING_EMULATOR` — free with `emcmake`

Per [CMake docs](https://cmake.org/cmake/help/latest/prop_tgt/CROSSCOMPILING_EMULATOR.html): *"Use the given emulator to run executables created when crosscompiling"*, prefixed onto `add_test()`, `add_custom_command()` and `add_custom_target()`. Since CMake 3.3; semicolon-separated list args since 3.15 (first value is the command, the rest are arguments); generator expressions since 3.29.

Emscripten wires this automatically. From the local install (`emscripten 5.0.7`):

- `emcmake.py:37-40`
  ```python
  if not has_substr(args, '-DCMAKE_CROSSCOMPILING_EMULATOR'):
      node_js = config.NODE_JS[0]
      args.append(f'-DCMAKE_CROSSCOMPILING_EMULATOR={node_js}')
  ```
- `cmake/Modules/Platform/Emscripten.cmake:20` `set(CMAKE_CROSSCOMPILING TRUE)`
- `cmake/Modules/Platform/Emscripten.cmake:275` `set(CMAKE_EXECUTABLE_SUFFIX ".js")`
- `cmake/Modules/Platform/Emscripten.cmake:365-368` — fallback `find_program(NODE_JS_EXECUTABLE NAMES nodejs node)`

### Verified run (cmake 4.3.2)

```
$ grep CROSSCOMPILING_EMULATOR build-ct/CMakeCache.txt
CMAKE_CROSSCOMPILING_EMULATOR:UNINITIALIZED=/opt/homebrew/opt/node/bin/node

$ ctest --output-on-failure
1/3 Test #1: atomlist ....... Passed  0.27 sec
2/3 Test #2: gfn2 ........... Passed  0.23 sec
3/3 Test #3: spawn .......... Passed  0.31 sec
100% tests passed, 0 tests failed out of 3
```

For WASI you would set it by hand: `-DCMAKE_CROSSCOMPILING_EMULATOR="wasmtime;run;--dir;/::/;--env;XTBPATH"`.

---

## 4. What a wasm32-wasi meson cross file looks like

A real one, from [meson issue #7489](https://github.com/mesonbuild/meson/issues/7489):

```ini
[host_machine]
system = 'wasi'
cpu_family = 'wasm32'
cpu = 'wasm32'
endian = 'little'

[binaries]
c  = '$HOME/.local/opt/wasi-sdk-11.0/bin/clang'
ar = '$HOME/.local/opt/wasi-sdk-11.0/bin/ar'
ld = '$HOME/.local/opt/wasi-sdk-11.0/bin/wasm-ld'

[properties]
c_args      = [ '--target=wasm32-unknown-wasi', '--sysroot', '…/wasi-sysroot' ]
c_link_args = [ '--target=wasm32-unknown-wasi', '--sysroot', '…/wasi-sysroot' ]
```

Note it has **no `exe_wrapper`**. Mine (`demo/cross-wasi.ini`, wasi-sdk 34 + wasmtime 48) adds one:

```ini
exe_wrapper = ['…/wasmtime', 'run', '--dir', '/::/', '--env', 'XTBPATH']
```

**Emscripten vs WASI, the deltas that matter:**

| | emscripten | wasm32-wasi |
|---|---|---|
| compiler binaries | `emcc`/`em++`/`emar`/`emranlib` (wrappers) | `clang`/`llvm-ar` + `--target`/`--sysroot` |
| meson `system =` | `'emscripten'` | `'wasi'` |
| output artifact | `tester.js` + `tester.wasm` | `tester` (raw wasm; `file` → *WebAssembly (wasm) binary module version 0x1 (MVP)*) |
| `exe_wrapper` | `'node'` | `['wasmtime','run',…]` or a `node:wasi` shim |
| env vars reach guest | **yes**, transparently | **no**, needs explicit `--env` |
| filesystem | `-sNODERAWFS=1` → real host fs | explicit `--dir` preopens |

---

## 5. The WASI runtime story in 2026

| Runtime | Version tested / current | Verdict for a Fortran test binary |
|---|---|---|
| **node 26** `node:wasi` | v26.0.0 local; docs at v26.7.0 | Library API only. **Cannot run a `.wasm` from the CLI.** Works fine as a hand-written shim. `preview1` only; still experimental. |
| **wasmtime** | **48.0.1** (2026-08-24) | Best CLI ergonomics for this job; WASIp2 stable, WASIp3/async landing. What I used. |
| **wasmer** | 6.0 line | Also runs preview1; its non-standard **WASIX** fork is the only thing in the ecosystem offering `fork()`/subprocesses — but no Fortran toolchain targets WASIX. |

Two node findings worth recording:

- On **v26.0.0**, `new WASI({version:'preview1'})` works **without** `--experimental-wasi-unstable-preview1`; you get `ExperimentalWarning: WASI is an experimental feature and might change at any time`. The flag is still accepted. `node --help` shows only `--allow-wasi` and `--disable-wasm-trap-handler`; there is no runner.
- `node t2.wasm gfn2` → `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'wasi_snapshot_preview1'`. Node's wasm-ESM integration tries to resolve the WASI import namespace as a JS package. **So `exe_wrapper = 'node'` is an emscripten-only trick.**

A working 18-line shim (`demo/wasi-run.mjs`), verified against a wasi-sdk binary:

```js
import { WASI } from 'node:wasi';
import { readFile } from 'node:fs/promises';
import { argv, env, exit } from 'node:process';

const [modulePath, ...rest] = argv.slice(2);
const wasi = new WASI({
  version: 'preview1',
  args: [modulePath, ...rest],
  env,                      // inherits XTBPATH for free — unlike wasmtime
  preopens: { '/': '/' },
  returnOnExit: true,
});
const wasm = await WebAssembly.compile(await readFile(modulePath));
exit(wasi.start(await WebAssembly.instantiate(wasm, wasi.getImportObject())));
```

### Two WASI footguns I hit, both directly fatal for xtb

**(a) Meson's `env:` does not cross the WASI boundary.** With `exe_wrapper = ['wasmtime','run','--dir','.']` and no `--env`, meson set `XTBPATH` on the *wasmtime host process*; the guest saw nothing:

```
# Running suite 'gfn2'
# XTBPATH=(unset)
…
1/3 unit - wasmtestdemo:atomlist FAIL  exit status 2
2/3 unit - wasmtestdemo:gfn2     FAIL  exit status 2
```

Fix: `--env XTBPATH` (the bare form inherits from the calling process, per `wasmtime run --help`). This is exactly `xtb/meson.build:216` and `test/unit/CMakeLists.txt:97`, i.e. it would break **all 29 unit tests** silently.

**(b) Preopen shadowing.** Adding a cwd preopen after a root preopen kills absolute-path opens:

```
$ wasmtime run --dir "/::/"           --env XTBPATH tw.wasm gfn2
# fopen(/…/param_gfn2-xtb.txt) -> ok
$ wasmtime run --dir "/::/" --dir .   --env XTBPATH tw.wasm gfn2
# fopen(/…/param_gfn2-xtb.txt) -> FAILED
```

Reproduced identically with `node:wasi` (`preopens: {'/':'/', '.':cwd}` fails; `{'/':'/'}` works). xtb's harness needs **both**: absolute reads under `XTBPATH` (source tree) *and* relative writes in the build dir (scratch file, `--namespace testN` output).

---

## 6. Runtime facilities: what each target actually provides

Measured, not inferred. Emscripten column = emcc 5.0.7 + `-sNODERAWFS=1` under node 26. WASI column = `nm -g --defined-only wasi-sdk-34.0-arm64-macos/share/wasi-sysroot/lib/wasm32-wasip1/libc.a` (clang 23.1.0-wasi-sdk, released 2026-08-25), corroborated by link attempts.

| Facility | xtb needs it for | emscripten + node | wasm32-wasip1 |
|---|---|---|---|
| argv | suite dispatch (`main.f90`), `Info`, argparser | ✅ | ✅ |
| `getenv` | `XTBPATH` (`systools.F90:145`) | ✅ transparent | ✅ *but* runner must forward it |
| file open/read (absolute) | `rdpath` param lookup | ✅ real host paths | ✅ with `--dir` |
| file write, directories | `--namespace testN` | ✅ mkdir/chdir/getcwd/rmdir/chmod/symlink all 0 | ✅ getcwd, chdir, ftruncate, symlink DEFINED |
| `tmpfile` / `mkstemp` | `STATUS='SCRATCH'` (`test_gfn2.f90:607`) | ✅ | ❌ **absent** |
| stdout/stderr | test-drive output | ✅ | ✅ |
| exit codes | `should_fail`, pass/fail | ✅ (verified 0/1/3/4) | ✅ (verified 0/1/3/4) |
| `signal()` | `mctc_init` → **every test** | ✅ (returns 0, `raise` dispatches) | ❌ **absent** |
| `system()` | `execute_command_line` | ✅ (see below) | ❌ **absent** |
| `fork`/`execl`/`wait` | async `execute_command_line` | links, returns `-1 ENOSYS` | ❌ absent |
| `link()` (hard link) | — (dead code) | ❌ returns -1 | n/a |
| OpenMP | 43 source files | ❌ `omp.h` not found | ❌ `omp.h` not found |

Also missing from wasi-libc: `tmpnam`, `popen`, `raise`.

### The decisive WASI blocker

```
$ wasi-sdk-34.0-arm64-macos/bin/clang -c xtb/src/mctc/signal.c
xtb/src/mctc/signal.c:16:4: error: call to undeclared function 'signal'
```

That file is in **both** builds (`src/mctc/meson.build:56`, `src/mctc/CMakeLists.txt:58`) and is invoked at `test/unit/main.f90:57` → `src/mctc/mctc_init.F90:52-53` before any assertion runs. Under emcc the same file compiles, links and dispatches correctly. And the scratch-file path is equally blocked: `share/wasi-sysroot/include/wasm32-wasip1/stdio.h:153` reads

```c
FILE *tmpfile(void) __attribute__((__deprecated__("tmpfile is not defined on WASI")));
```

with `wasm-ld: error: undefined symbol: tmpfile` on link.

**This is why WASI is out for xtb** — not a numerical or performance argument, a hard link error on the first line of every test.

---

## 7. `execute_command_line` — the surprising answer

xtb has 26 hits, all in external-QM-driver code:

- `src/extern/turbomole.f90:234,236,274-278,315-318,347-348,536,588`
- `src/extern/orca.f90:542,545,754`, `src/extern/mopac.f90:216`, `src/extern/driver.f90:195`
- `src/screening.f90:300,303`
- (`src/dipro.F90:341` is a comment)

**No test exercises any of them.** So this is a link/latent concern, not a failing-test concern. Same for `src/mctc/mctc_linux.f90` (mkdir/rmdir/link/unlink/symlink/chdir/chmod C bindings) — grep shows **zero users** outside the module.

But the linkability answer is non-obvious and worth knowing:

**Emscripten actually implements `system()` under node.** `emscripten 5.0.7 src/lib/libcore.js:375-407`:

```js
_emscripten_system: (command) => {
#if ENVIRONMENT_MAY_BE_NODE
  if (ENVIRONMENT_IS_NODE) {
    if (!command) return 1;                       // shell is available
    var cmdstr = UTF8ToString(command);
    if (!cmdstr.length) return 0;
    var cp = require('node:child_process');
    var ret = cp.spawnSync(cmdstr, [], {shell:true, stdio:'inherit'});
    …
    return _W_EXITCODE(ret.status, 0);
  }
#endif
  if (!command) return 0;                          // no shell available (browser)
  return -{{{ cDefs.ENOSYS }}};
},
```

My `spawn` test genuinely printed `hello-from-subprocess` / `# system() returned 0` and **passed under `meson test`**. And flang-rt lowers Fortran to exactly this: `flang-rt/lib/runtime/execute.cpp`, `RTNAME(ExecuteCommandLine)` calls `std::system(cmd)` for `WAIT=.true.` (xtb's default) and `fork()`/`setsid()`/`execl()` for `WAIT=.false.`.

So: **works under emcc+node; returns `-ENOSYS` (−52) in a browser; cannot even instantiate under a pure-WASI runtime**:

```
$ emcc tester.c -o tester_sa.wasm -sSTANDALONE_WASM -sPURE_WASI=1
$ wasmtime run --dir . tester_sa.wasm gfn2
Error: failed to instantiate "tester_sa.wasm"
  unknown import: `env::_emscripten_system` has not been defined
```

**Standards position:** [WASI `docs/Proposals.md`](https://github.com/WebAssembly/WASI/blob/main/docs/Proposals.md) as of 2026-08 has Phase 5 and Phase 4 **empty**; Phase 3 = Clocks, Random, Filesystem, Sockets, CLI, HTTP; Phase 1 includes Threads. **There is no process/spawn/exec proposal at any phase, including Phase 0.** Wasmer's WASIX is the only thing offering `fork()`, and nothing Fortran targets it.

---

## 8. Emscripten filesystem options for the test data

xtb's tests read from the **source tree** (`XTBPATH=meson.current_source_dir()`, `assets/inputs/**` for `Info`) and write into the **build dir**. Three options:

| Option | Behaviour | Fit for xtb's suite |
|---|---|---|
| **`-sNODERAWFS=1`** | *"replaces all normal filesystem access with direct Node.js operations, without the need to do `FS.mount()`"*; cwd is `process.cwd()`, not the VFS root; node-only. **Auto-enables `NODE_HOST_ENV`**, which is why `XTBPATH` arrived with zero wrapper changes. | ✅ **the right answer.** Source tree and build dir are just visible. Nothing is staged, nothing diverges from the native run. |
| `--preload-file <dir>` | Packages into a separate `.data` bundle fetched at startup; the generated `.js` must load before the main module. | Workable but you must enumerate `assets/`, all `param_*.txt`, `.param_gfnff.xtb` — and writes go to MEMFS, so `--namespace testN` output vanishes. |
| `--embed-file` | Inlines into the JS. *"Embedding files is more efficient than preloading because there isn't a separate file to download and copy, but preloading enables the option to separately host the data."* | Only for the eventual browser bundle, not for testing. |

Confirmed empirically: under NODERAWFS `getcwd()` returned the real host directory; under default MEMFS the same program reported `/wtest`.

Two link settings that are not optional for a Fortran port (`emscripten 5.0.7 src/settings.js`):

- `:113` `var STACK_SIZE = 64*1024;` — 64 KB, with the comment at `:110-112` warning it *"will fail silently"* without assertions. Fortran automatic/temporary arrays blow through this immediately. Set `-sSTACK_SIZE=…` explicitly.
- `:211` `var MAXIMUM_MEMORY = 2147483648;` (2 GB default; wasm32 ceiling is 4 GB). Add `-sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=…`.

Also: `-sEXIT_RUNTIME=1` is required or `main()`'s return value never becomes a process exit code — which would break `should_fail: true` and every pass/fail signal.

---

## 9. Does the Fortran runtime provide the I/O layer under wasm?

**Upstream: no.** `flang/lib/Optimizer/CodeGen/Target.cpp` on llvm/llvm-project `main` enumerates x86, x86_64, aarch64, ppc, ppc64, ppc64le, sparc, sparcv9, riscv64, amdgpu, nvptx64, loongarch64, systemz at lines 2043-2101 — **no wasm case**. [llvm-project#54832](https://github.com/llvm/llvm-project/issues/54832) ("WebAssembly (wasm32-wasi) target for flang") was opened 2022-04-10 and closed 2022-04-21 with no implementation.

**Out of tree: yes, and it is maintained.** [emscripten-forge/recipes](https://github.com/emscripten-forge/recipes) `recipes_emscripten/libflang/recipe.yaml` pins `llvmorg-22.1.6` plus four patches from `serge-sans-paille/llvm-project` branch `feature/flang-wasm`:

```
0001-Minimal-WASM-support-for-flang.patch
0002-Deactivate-quadmath-float128-support.patch
0003-Specialize-Flang-to-target-WASM.patch
0004-Fix-wasm32-assumed-size-dummy-array-indexing.patch
```

`recipes_emscripten/libflang/build.sh` builds **flang-rt itself for wasm**:

```sh
emcmake cmake -S ./runtimes -B _build -GNinja \
  -DLLVM_ENABLE_RUNTIMES=flang-rt \
  -DCMAKE_Fortran_COMPILER=flang -DCMAKE_Fortran_COMPILER_WORKS=ON \
  -DLLVM_DEFAULT_TARGET_TRIPLE=wasm32-unknown-emscripten \
  -DFLANG_RT_INCLUDE_TESTS=OFF -DLLVM_INCLUDE_TESTS=OFF \
  -DFLANG_RUNTIME_F128_MATH_LIB=""
…
# → $PREFIX/lib/clang/22/lib/wasm32-unknown-emscripten/libflang_rt.runtime.a
```

`prefix.dev` lists `flang_emscripten-wasm32` **v22.1.6**, updated ~3 months ago (≈May 2026). So the artifact exists and is current.

### What is known to be missing — be precise about this

**The runtime's own test suite is switched off**: `-DFLANG_RT_INCLUDE_TESTS=OFF -DLLVM_INCLUDE_TESTS=OFF`. The *entire* validation in that recipe is:

```sh
flang $FFLAGS -c $RECIPE_DIR/hello.f90 -o hello.o
emcc hello.o -L$PREFIX/lib -lflang_rt.runtime -o hello.js -sEXIT_RUNTIME=1
node hello.js | grep -F "Hello, Fortran!"
```

One list-directed `PRINT *`. **Nothing exercises `OPEN`/`READ`/`WRITE`/`INQUIRE`/`BACKSPACE`/`ENDFILE`, formatted edit descriptors, non-advancing I/O, unit management, or scratch files on wasm.** So the honest statement is not "the I/O layer is broken" — it is "**the I/O layer is entirely unvalidated on wasm, and xtb's suite would be the first thing to stress it.**"

Two concrete things already visible in flang-rt's source that will need attention:

- **Scratch files.** `flang-rt/lib/runtime/file.cpp:33-58`, dispatched from `OpenFile::Open` at `:76-84` when `status == OpenStatus::Scratch`:
  ```cpp
  char path[]{"/tmp/Fortran-Scratch-XXXXXX"};   // :51
  int fd{::mkstemp(path)};                       // :52
  ::unlink(path);                                // :58
  ```
  A **hard-coded absolute `/tmp`**. Fine under NODERAWFS (real host `/tmp`); impossible under wasi-libc, which has no `mkstemp`. Exercised by `test/unit/test_gfn2.f90:607`.
- **Quad precision is patched out** (`0002-Deactivate-quadmath-float128-support`, `FLANG_RUNTIME_F128_MATH_LIB=""`). Harmless if xtb is `real(wp)=real64` throughout, but worth a grep for `real128`/`selected_real_kind(33` before relying on it.

Historical context on why patches are needed at all — George Stagg's [Fortran on WebAssembly](https://gws.phd/posts/fortran_wasm/): a `TargetWasm32` struct in `flang/lib/Optimizer/CodeGen/Target.cpp`, plus hard-coding `long`/`unsigned long` to 32-bit in `RTBuilder.h` and 32-bit `malloc` signatures in `CodeGen.cpp`, because "the result of `sizeof(long)` on our compiler's host platform is 8 bytes (`i64`), but for `wasm32-unknown-emscripten` the returned value should be 4 bytes (`i32`)". He is explicit that "this hack means that I cannot contribute the changes back to LLVM without assistance from a more experienced compiler developer."

**One more hard constraint:** neither toolchain has OpenMP.

```
$ emcc -fopenmp omp.c            → fatal error: 'omp.h' file not found
$ wasi-sdk-34/bin/clang -fopenmp → fatal error: 'omp.h' file not found
```

xtb defaults to `openmp=true` (`meson_options.txt`, wired at `meson/meson.build:108-115`), so `-Dopenmp=false` is mandatory. The test driver's `!$omp critical(testdrive_testsuite)` at `test/unit/main.f90:149-152,178-180` degrade to comments — harmless, and serial execution removes OMP reduction-order nondeterminism, which should make the 1e-7 tolerances *easier* to hit, not harder.

---

## 10. The exact command sequence

Assuming a working Fortran-to-wasm compiler (the emscripten-forge `flang` + `libflang_rt.runtime.a`) and wasm BLAS/LAPACK.

### Setup

```sh
# 1. Emscripten SDK + node
git clone https://github.com/emscripten-core/emsdk && cd emsdk
./emsdk install latest && ./emsdk activate latest && source ./emsdk_env.sh

# 2. Patched flang + flang-rt for wasm32-unknown-emscripten
micromamba create -n xtbwasm -c https://prefix.dev/emscripten-forge-dev \
    -c conda-forge flang_emscripten-wasm32=22.1.6 libflang
# provides: flang (host binary, wasm32 default triple)
#           $PREFIX/lib/clang/22/lib/wasm32-unknown-emscripten/libflang_rt.runtime.a

# 3. Netlib LAPACK/BLAS built for wasm (emscripten-forge ships lapack/openblas recipes)
```

### Cross file — `cross/wasm32-emscripten-fortran.ini`

```ini
[binaries]
c          = 'emcc'
cpp        = 'em++'
fortran    = 'flang'
ar         = 'emar'
ranlib     = 'emranlib'
exe_wrapper = 'node'

[built-in options]
c_link_args       = ['-sNODERAWFS=1', '-sEXIT_RUNTIME=1', '-sALLOW_MEMORY_GROWTH=1',
                     '-sSTACK_SIZE=8MB', '-sINITIAL_MEMORY=512MB',
                     '-L@PREFIX@/lib', '-lflang_rt.runtime']
fortran_link_args = ['-sNODERAWFS=1', '-sEXIT_RUNTIME=1', '-sALLOW_MEMORY_GROWTH=1',
                     '-sSTACK_SIZE=8MB', '-sINITIAL_MEMORY=512MB',
                     '-L@PREFIX@/lib', '-lflang_rt.runtime']

[properties]
needs_exe_wrapper = true

[host_machine]
system     = 'emscripten'
cpu_family = 'wasm32'
cpu        = 'wasm32'
endian     = 'little'
```

### Build and test — Meson

```sh
meson setup build-wasm \
  --cross-file cross/wasm32-emscripten-fortran.ini \
  -Dopenmp=false \
  -Ddefault_library=static \
  -Dlapack=custom -Dcustom_libraries='lapack,blas' \
  -Dtblite=disabled -Dcpcmx=disabled          # narrow the first attempt
meson compile -C build-wasm                   # links tester.js + tester.wasm, xtb.js + xtb.wasm
meson test -C build-wasm --print-errorlogs --no-rebuild -t 600 --num-processes 1
```

`-Ddefault_library=static` matters: xtb defaults to `both` (`meson.build:27`), and emscripten shared libraries (SIDE_MODULE) are a separate ordeal you do not want on the test path. `-t 600` because upstream already needs `-t 120` natively (`.github/workflows/fortran-build.yml:56`) and wasm is slower. `--num-processes 1` mirrors upstream's own serial invocations at `:253,365`.

Meson then runs, for each of the 35 tests:

```
XTBPATH=<srcdir> MESON_EXE_WRAPPER=<node> … node build-wasm/tester.js gfn2
```

### Build and test — CMake

```sh
emcmake cmake -B build-wasm-cmake -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_Fortran_COMPILER=flang \
  -DWITH_OpenMP=FALSE -DWITH_TBLITE=false -DWITH_CPCMX=false \
  -DCMAKE_EXE_LINKER_FLAGS="-sNODERAWFS=1 -sEXIT_RUNTIME=1 -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=8MB -lflang_rt.runtime"
cmake --build build-wasm-cmake
cd build-wasm-cmake && ctest --output-on-failure --timeout 3600
```

`emcmake` supplies `CMAKE_CROSSCOMPILING_EMULATOR=<node>` and `CMAKE_EXECUTABLE_SUFFIX=.js` automatically. Note `test/api/CMakeLists.txt:24` links the C-API test against `lib-xtb-shared`, which will need switching to the static target under emscripten.

### If someone insists on WASI anyway

```ini
exe_wrapper = ['wasmtime', 'run', '--dir', '/::/', '--env', 'XTBPATH', '--env', 'PATH']
```

Do **not** add a `--dir .` after `--dir /::/` (§5b). And expect to patch `src/mctc/signal.c` and flang-rt's `openfile_mkstemp` before anything links.

---

## 11. Verdict

**Is the criterion achievable?** The *harness* half is a non-issue — I ran it three ways today, and both of xtb's build systems already support it with configuration alone, no source edits. Emscripten + NODERAWFS + node is close to a perfect emulation of the native test environment: argv, env, the real source tree, the real build dir, exit codes, `signal()`, even `system()`.

**The residual risk is concentrated in exactly two places**, and neither is about test plumbing:

1. **flang-rt's I/O layer on wasm is unvalidated.** The library builds and prints "Hello, Fortran!". xtb's 29 suites will be the first workload to drive `OPEN`/`READ`/`INQUIRE`/scratch-files/formatted-I/O through it in anger. Expect to find and fix bugs there — but they are fixable, and upstream-able, because the emscripten path has all the underlying POSIX calls.
2. **Numerics.** 558 assertions at tolerances down to 1e-7 Hartree, against a different LAPACK/BLAS, with OpenMP off, in a 32-bit address space. That is the other study's problem, but it is where "all tests pass" is most likely to become "34 of 35 tests pass".

**WASI should be ruled out now, on mechanical grounds.** Not because it is slower or less mature — because `signal()` does not exist in wasi-libc, `src/mctc/signal.c:16` will not compile, and `mctc_init` runs before the first assertion in all 29 suites. Add missing `mkstemp`/`tmpfile` for `STATUS='SCRATCH'`, missing `system` for `execute_command_line`, and an environment-passing model that silently drops `XTBPATH`, and you are patching the project to satisfy the runtime — which is precisely what the requirement forbids.

**Sources**

- [Meson: Cross compilation](https://mesonbuild.com/Cross-compilation.html) · [`cross/wasm32-emscripten.txt`](https://raw.githubusercontent.com/mesonbuild/meson/master/cross/wasm32-emscripten.txt) · [meson#7489 (wasi-sdk cross file)](https://github.com/mesonbuild/meson/issues/7489) · [meson#10102](https://github.com/mesonbuild/meson/issues/10102)
- [CMake `CROSSCOMPILING_EMULATOR`](https://cmake.org/cmake/help/latest/prop_tgt/CROSSCOMPILING_EMULATOR.html)
- [Emscripten settings reference](https://emscripten.org/docs/tools_reference/settings_reference.html) · [Packaging files](https://emscripten.org/docs/porting/files/packaging_files.html)
- [Node.js v26 WASI docs](https://nodejs.org/api/wasi.html) · [Node.js CLI docs](https://nodejs.org/api/cli.html)
- [WASI proposals list](https://github.com/WebAssembly/WASI/blob/main/docs/Proposals.md) · [wasi-sdk](https://github.com/WebAssembly/wasi-sdk) · [wasmtime releases](https://github.com/bytecodealliance/wasmtime/releases) · [Announcing WASIX](https://wasmer.io/posts/announcing-wasix)
- [llvm-project#54832](https://github.com/llvm/llvm-project/issues/54832) · [Flang & Web Assembly (LLVM Discourse)](https://discourse.llvm.org/t/flang-web-assembly/61607) · [George Stagg, Fortran on WebAssembly](https://gws.phd/posts/fortran_wasm/) · [r-wasm/flang-wasm](https://github.com/r-wasm/flang-wasm) · [emscripten-forge `flang_emscripten-wasm32`](https://prefix.dev/channels/emscripten-forge-4x/packages/flang_emscripten-wasm32)
