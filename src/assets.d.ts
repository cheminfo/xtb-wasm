/**
 * The wasm binary and its data package are resolved through the bundler, not
 * fetched from a hard-coded path, so that a consumer's own asset pipeline
 * decides where they are served from and how they are hashed.
 *
 * This is the one place the library requires a Vite-compatible bundler: the
 * `?url` suffix is Vite's, and a consumer using something else must alias these
 * two specifiers to the files inside `@peterspackman/occjs`.
 */
declare module '@peterspackman/occjs/wasm?url' {
  const url: string;
  export default url;
}

declare module '@peterspackman/occjs/data?url' {
  const url: string;
  export default url;
}
