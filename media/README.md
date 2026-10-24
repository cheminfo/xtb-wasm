# vendor

`peterspackman-occjs-0.9.6.tgz` is `@peterspackman/occjs` 0.9.6, built by occ's
own CI from commit
[`b3779c3`](https://github.com/peterspackman/occ/commit/b3779c3) (Actions run
[39693136435](https://github.com/peterspackman/occ/actions/runs/39693136435),
artifact `occjs-package-node24`).

It carries the fix for [occ #58](https://github.com/peterspackman/occ/issues/58):
GFN2's D4 dispersion is self-consistent, so the gradient behind every Hessian and
every geometry optimization is the derivative of the energy. npm stops at 0.9.5,
which does not have it.

`package.json` lists it in `bundleDependencies`, so the published package carries
this build inside it and every consumer gets the fix by updating `xtb-wasm`
alone. Once 0.9.6 is on npm, delete this folder, depend on `^0.9.6` and drop
`bundleDependencies`.
