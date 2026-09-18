/**
 * The smallest DOM surface a Mol* `PluginContext` touches when it is constructed
 * but never mounted. Lets the state tree and the animation loop be unit-tested in
 * Node with no jsdom and no WebGL.
 */
export function installDomStub(): void {
  if ('document' in globalThis) return;
  const noop = () => {};
  const element = () => ({
    style: {},
    dataset: {},
    classList: { add: noop, remove: noop, toggle: noop },
    appendChild: noop,
    removeChild: noop,
    addEventListener: noop,
    removeEventListener: noop,
    setAttribute: noop,
    getContext: () => null,
    parentElement: null,
  });
  Object.assign(globalThis, {
    document: {
      addEventListener: noop,
      removeEventListener: noop,
      createElement: element,
      createElementNS: element,
      body: element(),
      documentElement: element(),
      fullscreenElement: null,
      exitFullscreen: noop,
    },
    window: { addEventListener: noop, removeEventListener: noop, devicePixelRatio: 1 },
  });
}
