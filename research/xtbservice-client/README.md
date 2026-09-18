# xtbservice client

A verified TypeScript client for `https://ir.cheminfo.org/v1`, plus the
normalization layer that puts the server's output and a local occjs engine into
one comparable shape.

Findings that motivated every non-obvious decision here are in
`../16-server-side-ir-service.md`.

- `types.ts` — the raw payload, as it really is (not as the OpenAPI describes it).
- `client.ts` — `fetchIrSpectrum`, with timeout + abort and a measured error taxonomy.
- `errors.ts` — `XtbServiceError` and its `kind` discriminator.
- `fold.ts` — ASE-compatible Gaussian folding; reproduces the server grid to ~1e-16.
- `normalize.ts` — `normalizeXtbService` and `normalizeLocalEngine`.
- `normalized.ts` — the shared `IrResult` shape.
- `vite.config.ts` — an optional dev proxy. CORS is open, so it is not required.

Tests: 27 passing, 92% statement coverage. `src/__tests__` expects the three
fixture payloads (`water.json`, `eth_GFN2xTB.json`, `benzene.json`) alongside
them; regenerate with e.g.
`curl -s 'https://ir.cheminfo.org/v1/ir?smiles=O&method=GFN2xTB' -o water.json`.
