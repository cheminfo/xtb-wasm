/** Why an xtbservice request failed, in a form the UI can branch on. */
export type XtbErrorKind =
  /** The caller's AbortSignal fired. */
  | 'aborted'
  /** The client-side timeout elapsed. */
  | 'timeout'
  /**
   * nginx returned 504 after ~60s. In practice this is what a too-large or
   * too-slow molecule produces — the documented 422 "too many atoms" is not
   * reachable through the deployed proxy.
   */
  | 'gatewayTimeout'
  /** FastAPI 422: a missing or malformed parameter. */
  | 'validation'
  /** The molecule exceeded MAX_ATOMS and the app reported it before the proxy gave up. */
  | 'tooLarge'
  /** 500. Unparseable SMILES, an unknown method, or an xtb crash. */
  | 'server'
  /** DNS, TLS, offline, or a CORS rejection. */
  | 'network'
  /** 2xx whose body was not the expected JSON. */
  | 'badResponse';

/** An error raised by the xtbservice client. */
export class XtbServiceError extends Error {
  readonly kind: XtbErrorKind;
  readonly status: number | null;
  /** The response body, truncated. nginx errors are HTML, not JSON. */
  readonly body: string | null;

  constructor(
    kind: XtbErrorKind,
    message: string,
    options: { status?: number | null; body?: string | null; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'XtbServiceError';
    this.kind = kind;
    this.status = options.status ?? null;
    this.body = options.body ?? null;
  }
}
