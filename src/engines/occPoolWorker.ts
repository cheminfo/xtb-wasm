import type {
  LoadedMessage,
  ProgressMessage,
  WorkerCommand,
  WorkerMessage,
} from './occWorkerProtocol.ts';

/** One worker of the pool, with its own occjs module instance. */
export interface PoolWorker {
  worker: Worker;
}

/** What the pool shares between its workers so the wasm is prepared once. */
interface SharedResources {
  /** Where the bundler put `occjs.wasm`. */
  wasmUrl: string;
  /** Where the bundler put `occjs.data`. */
  dataUrl: string;
  /** @default undefined */
  wasmModule?: WebAssembly.Module;
  /** @default undefined */
  dataPackage?: ArrayBuffer;
}

let shared: Promise<SharedResources> | null = null;

/**
 * Start `count` workers and wait until every one has its occjs module loaded.
 *
 * The 21.5 MB wasm is compiled once on this thread and the resulting
 * `WebAssembly.Module` is structured-cloned to each worker, which measured a
 * K = 8 warm-up of 197 ms instead of 339 ms and a per-worker load of 73-113 ms
 * instead of 220-257 ms. Warm-up must be budgeted for the slowest engine, not
 * the fastest: Firefox's module load measured 381 ms against Chrome's 61 ms,
 * and its `vibrationalModes` is ~5x slower than Safari's.
 * @param count - How many workers to start.
 * @returns The started workers, in creation order; index 0 is the primary.
 */
export async function spawnPoolWorkers(count: number): Promise<PoolWorker[]> {
  const resources = await shareResources();
  const workers: PoolWorker[] = [];
  const loaded: Array<Promise<LoadedMessage>> = [];
  for (let index = 0; index < count; index++) {
    // `.js`, not `.ts`: TypeScript rewrites the extension of an import
    // specifier but never of a string inside `new URL`, so a `.ts` here ships
    // in `lib/` pointing at a file that only exists in `src/`. A bundler
    // resolving this from source maps `.js` back to the TypeScript module.
    const worker = new Worker(new URL('occWorker.js', import.meta.url), {
      type: 'module',
      name: `occ-${index}`,
    });
    const entry = { worker };
    workers.push(entry);
    loaded.push(
      sendCommand(
        entry,
        {
          cmd: 'load',
          wasmPath: resources.wasmUrl,
          dataPath: resources.dataUrl,
          wasmModule: resources.wasmModule,
          dataPackage: resources.dataPackage,
        },
        'loaded',
      ),
    );
  }
  try {
    await Promise.all(loaded);
  } catch (error) {
    terminatePoolWorkers(workers);
    throw error;
  }
  return workers;
}

/**
 * Send one command and wait for the matching reply. Only one command may be
 * outstanding per worker, which the pool guarantees.
 * @param entry - The worker to talk to.
 * @param command - The command to send.
 * @param expected - The `type` of the reply that resolves this call.
 * @param onProgress - Receives the progress messages that arrive meanwhile.
 * @returns The matching reply.
 * @throws When the worker replies with an error or fails to start.
 */
export function sendCommand<Type extends WorkerMessage['type']>(
  entry: PoolWorker,
  command: WorkerCommand,
  expected: Type,
  onProgress?: (message: ProgressMessage) => void,
): Promise<Extract<WorkerMessage, { type: Type }>> {
  const { worker } = entry;
  return new Promise((resolve, reject) => {
    function cleanup(): void {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
    }
    function onMessage(event: MessageEvent<WorkerMessage>): void {
      const message = event.data;
      if (message.type === 'progress') {
        onProgress?.(message);
        return;
      }
      if (message.type === 'error') {
        cleanup();
        reject(new Error(message.message));
        return;
      }
      if (message.type !== expected) return;
      cleanup();
      resolve(message as Extract<WorkerMessage, { type: Type }>);
    }
    function onError(event: ErrorEvent): void {
      cleanup();
      reject(new Error(event.message || 'the occjs worker failed to start'));
    }
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage(command);
  });
}

/**
 * Terminate every worker. This is the only way to stop a running sweep, because
 * the wasm call inside a worker is synchronous and never reads its message
 * queue while it runs.
 * @param workers - The workers to stop.
 */
export function terminatePoolWorkers(workers: readonly PoolWorker[]): void {
  for (const entry of workers) {
    entry.worker.terminate();
  }
}

/** Compile the wasm and fetch the data package once for the whole pool. */
function shareResources(): Promise<SharedResources> {
  shared ??= prepareResources().catch((error: unknown) => {
    // A failed chunk load must not poison every later run of the session.
    shared = null;
    throw error;
  });
  return shared;
}

async function prepareResources(): Promise<SharedResources> {
  // Resolved on first use rather than at module load: a top-level `?url`
  // import makes the whole package unimportable outside a bundler, so Node —
  // and the package's own install check — could not even reach the types and
  // the chemistry that never touch the wasm.
  const [wasm, data] = await Promise.all([
    import('@peterspackman/occjs/wasm?url'),
    import('@peterspackman/occjs/data?url'),
  ]);
  const resources: SharedResources = {
    wasmUrl: wasm.default,
    dataUrl: data.default,
  };
  try {
    resources.wasmModule = await WebAssembly.compileStreaming(
      fetch(resources.wasmUrl),
    );
  } catch {
    // A dev server that serves the wasm with the wrong media type breaks
    // compileStreaming; each worker then compiles its own copy.
    resources.wasmModule = undefined;
  }
  try {
    const response = await fetch(resources.dataUrl);
    // A 404 resolves rather than throwing, and its body is an HTML error
    // page, so without this check the pool would hand emscripten a "data
    // package" of markup.
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    resources.dataPackage = await response.arrayBuffer();
  } catch {
    // Each worker then fetches the package itself, which is slower but works.
    resources.dataPackage = undefined;
  }
  return resources;
}
