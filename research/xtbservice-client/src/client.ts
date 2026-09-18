import { XtbServiceError } from './errors.ts';
import type { XtbMethod, XtbServiceIrResult } from './types.ts';

/**
 * Default base URL. CORS on ir.cheminfo.org is `Access-Control-Allow-Origin: *`,
 * so a browser on any origin can call it directly and no dev proxy is required.
 */
export const DEFAULT_BASE_URL = 'https://ir.cheminfo.org/v1';

/**
 * nginx in front of the service gives up at ~60s, so a longer client timeout
 * only delays the inevitable.
 */
export const DEFAULT_TIMEOUT_MS = 65_000;

export interface XtbServiceOptions {
  /** Service root including the version prefix. @default 'https://ir.cheminfo.org/v1' */
  baseUrl?: string;
  /** Milliseconds before the client aborts. @default 65000 */
  timeoutMs?: number;
  /** Caller signal, combined with the timeout. */
  signal?: AbortSignal;
  /** Injectable for tests. @default globalThis.fetch */
  fetch?: typeof globalThis.fetch;
}

export interface IrRequest {
  /** SMILES; the service adds implicit hydrogens. Mutually exclusive with `molFile`. */
  smiles?: string;
  /** V2000 molfile with explicit hydrogens; atom ordering is preserved. Requires POST. */
  molFile?: string;
  /** @default 'GFNFF' */
  method?: XtbMethod;
}

/**
 * Fetch a raw IR result from the xtbservice.
 *
 * Uses GET when only `smiles` is given (so the server's disk cache and any HTTP
 * cache can hit) and POST when a `molFile` is supplied.
 *
 * @param request - The molecule and method to compute.
 * @param options - Transport options.
 * @returns The raw service payload.
 * @throws XtbServiceError - Always this type; `kind` says what went wrong.
 */
export async function fetchIrSpectrum(
  request: IrRequest,
  options: XtbServiceOptions = {},
): Promise<XtbServiceIrResult> {
  const {
    baseUrl = DEFAULT_BASE_URL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
    fetch: fetchImpl = globalThis.fetch,
  } = options;

  if (!request.smiles && !request.molFile) {
    throw new XtbServiceError('validation', 'Provide either `smiles` or `molFile`.');
  }

  const method = request.method ?? 'GFNFF';
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  const useMolFile = Boolean(request.molFile);
  const url = useMolFile
    ? `${baseUrl}/ir`
    : `${baseUrl}/ir?smiles=${encodeURIComponent(request.smiles as string)}&method=${encodeURIComponent(method)}`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: useMolFile ? 'POST' : 'GET',
      // The service sends `Access-Control-Allow-Credentials: true` alongside
      // `Access-Control-Allow-Origin: *`. Browsers reject a credentialed request
      // against a wildcard origin, so credentials must stay off.
      credentials: 'omit',
      headers: useMolFile
        ? { 'content-type': 'application/json', accept: 'application/json' }
        : { accept: 'application/json' },
      body: useMolFile
        ? JSON.stringify({ molFile: request.molFile, method })
        : undefined,
      signal: combined,
    });
  } catch (error) {
    if (signal?.aborted) {
      throw new XtbServiceError('aborted', 'Request aborted by caller.', { cause: error });
    }
    if (timeoutSignal.aborted) {
      throw new XtbServiceError('timeout', `Request exceeded ${timeoutMs} ms.`, { cause: error });
    }
    throw new XtbServiceError(
      'network',
      `Could not reach ${baseUrl}. Check connectivity, or CORS if this is a browser.`,
      { cause: error },
    );
  }

  if (!response.ok) {
    throw await buildHttpError(response);
  }

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new XtbServiceError('badResponse', 'Response was not JSON.', {
      status: response.status,
      body: text.slice(0, 500),
      cause: error,
    });
  }

  const result = parsed as XtbServiceIrResult;
  if (!Array.isArray(result.modes) || !Array.isArray(result.wavenumbers)) {
    throw new XtbServiceError('badResponse', 'Response JSON lacked `modes`/`wavenumbers`.', {
      status: response.status,
      body: text.slice(0, 500),
    });
  }
  return result;
}

/**
 * Turn a non-2xx response into a typed error. The service mixes JSON (422),
 * plain text (500 "Internal Server Error") and HTML (nginx 504), so the body is
 * sniffed rather than assumed to be JSON.
 */
async function buildHttpError(response: Response): Promise<XtbServiceError> {
  const body = await response.text().catch(() => '');
  const snippet = body.slice(0, 500);

  if (response.status === 504 || response.status === 502) {
    return new XtbServiceError(
      'gatewayTimeout',
      'The service did not finish within the proxy timeout (~60s). The molecule is too large or too slow for the server.',
      { status: response.status, body: snippet },
    );
  }

  if (response.status === 422) {
    let detail = '';
    try {
      const parsed = JSON.parse(body) as { detail?: unknown };
      detail = typeof parsed.detail === 'string' ? parsed.detail : JSON.stringify(parsed.detail);
    } catch {
      detail = snippet;
    }
    const kind = detail.includes('atoms') ? 'tooLarge' : 'validation';
    return new XtbServiceError(kind, detail || 'Validation error.', {
      status: 422,
      body: snippet,
    });
  }

  return new XtbServiceError(
    'server',
    `Service returned ${response.status}. Unparseable SMILES, an unknown method, or an xtb crash all surface this way.`,
    { status: response.status, body: snippet },
  );
}
