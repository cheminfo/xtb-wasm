import { expect, test, vi } from 'vitest';

import { fetchIrSpectrum } from '../client.ts';
import { XtbServiceError } from '../errors.ts';

/** Await a call that must reject, and return the typed error. */
async function expectError(promise: Promise<unknown>): Promise<XtbServiceError> {
  try {
    await promise;
  } catch (error) {
    return error as XtbServiceError;
  }
  throw new Error('expected the request to reject');
}

const okBody = JSON.stringify({ wavenumbers: [0], intensities: [0], modes: [] });

function mockFetch(status: number, body: string, contentType = 'application/json') {
  return vi.fn(async () =>
    new Response(body, { status, headers: { 'content-type': contentType } }),
  ) as unknown as typeof globalThis.fetch;
}

test('a SMILES request is a GET with the smiles and method in the query string', async () => {
  const fetchImpl = mockFetch(200, okBody);
  await fetchIrSpectrum({ smiles: 'CCO', method: 'GFN2xTB' }, { fetch: fetchImpl });
  const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
  expect(url).toBe('https://ir.cheminfo.org/v1/ir?smiles=CCO&method=GFN2xTB');
  expect(init.method).toBe('GET');
  expect(init.body).toBeUndefined();
  expect(init.credentials).toBe('omit');
});

test('SMILES are URL-encoded so charges and ring closures survive', async () => {
  const fetchImpl = mockFetch(200, okBody);
  await fetchIrSpectrum({ smiles: 'CC(=O)[O-]', method: 'GFNFF' }, { fetch: fetchImpl });
  const [url] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
  expect(url).toBe('https://ir.cheminfo.org/v1/ir?smiles=CC(%3DO)%5BO-%5D&method=GFNFF');
});

test('a molFile request is a POST carrying molFile and method', async () => {
  const fetchImpl = mockFetch(200, okBody);
  await fetchIrSpectrum({ molFile: 'MOL', method: 'GFN1xTB' }, { fetch: fetchImpl });
  const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
  expect(url).toBe('https://ir.cheminfo.org/v1/ir');
  expect(init.method).toBe('POST');
  expect(JSON.parse(init.body as string)).toStrictEqual({ molFile: 'MOL', method: 'GFN1xTB' });
});

test('the method defaults to GFNFF, matching the service', async () => {
  const fetchImpl = mockFetch(200, okBody);
  await fetchIrSpectrum({ smiles: 'O' }, { fetch: fetchImpl });
  const [url] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
  expect(url).toContain('method=GFNFF');
});

test('an empty request is rejected before any network call', async () => {
  const fetchImpl = mockFetch(200, okBody);
  await expect(fetchIrSpectrum({}, { fetch: fetchImpl })).rejects.toThrow(XtbServiceError);
  expect(fetchImpl).not.toHaveBeenCalled();
});

test.each([
  [504, '<html><title>504 Gateway Time-out</title></html>', 'text/html', 'gatewayTimeout'],
  [502, 'bad gateway', 'text/html', 'gatewayTimeout'],
  [500, 'Internal Server Error', 'text/plain', 'server'],
])('HTTP %i maps to kind %s', async (status, body, contentType, kind) => {
  const error = await expectError(fetchIrSpectrum(
    { smiles: 'O' },
    { fetch: mockFetch(status as number, body as string, contentType as string) },
  ));
  expect(error).toBeInstanceOf(XtbServiceError);
  expect(error.kind).toBe(kind);
  expect(error.status).toBe(status);
});

test('a 422 mentioning atoms is tooLarge, other 422s are validation', async () => {
  const tooLarge = await expectError(fetchIrSpectrum({ smiles: 'O' }, {
    fetch: mockFetch(422, JSON.stringify({ detail: 'This services only accepts structures with less than 60 atoms' })),
  }));
  expect(tooLarge.kind).toBe('tooLarge');

  const invalid = await expectError(fetchIrSpectrum({ smiles: 'O' }, {
    fetch: mockFetch(422, JSON.stringify({ detail: [{ loc: ['query', 'smiles'], msg: 'field required', type: 'value_error.missing' }] })),
  }));
  expect(invalid.kind).toBe('validation');
});

test('a 200 that is not JSON is badResponse and keeps the body for display', async () => {
  const error = await expectError(fetchIrSpectrum({ smiles: 'O' }, {
    fetch: mockFetch(200, '<html>login</html>', 'text/html'),
  }));
  expect(error.kind).toBe('badResponse');
  expect(error.body).toBe('<html>login</html>');
});

test('a 200 JSON body missing modes is badResponse', async () => {
  const error = await expectError(fetchIrSpectrum({ smiles: 'O' }, {
    fetch: mockFetch(200, JSON.stringify({ hello: 'world' })),
  }));
  expect(error.kind).toBe('badResponse');
});

test('a caller abort surfaces as kind "aborted"', async () => {
  const controller = new AbortController();
  const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
    return await new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => { reject(new Error('aborted')); });
    });
  }) as unknown as typeof globalThis.fetch;

  const promise = fetchIrSpectrum({ smiles: 'O' }, { fetch: fetchImpl, signal: controller.signal });
  controller.abort();
  const error = await expectError(promise);
  expect(error.kind).toBe('aborted');
});

test('the client timeout surfaces as kind "timeout"', async () => {
  const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
    return await new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => { reject(new Error('timeout')); });
    });
  }) as unknown as typeof globalThis.fetch;

  const error = await expectError(fetchIrSpectrum({ smiles: 'O' }, { fetch: fetchImpl, timeoutMs: 5 }));
  expect(error.kind).toBe('timeout');
});

test('a transport failure surfaces as kind "network"', async () => {
  const fetchImpl = vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof globalThis.fetch;
  const error = await expectError(fetchIrSpectrum({ smiles: 'O' }, { fetch: fetchImpl }));
  expect(error.kind).toBe('network');
});
