import { loadOCC } from '@peterspackman/occjs';
import * as pkg from '@peterspackman/occjs';
const M = await loadOCC({ env: { print: () => {}, printErr: () => {} } });
try { M.setLogLevel(M.LogLevel.OFF); } catch {}
const RE = /dipol|intens|infrar|polariz|ir_|raman/i;
console.log('--- module-level keys matching', RE);
for (const k of Object.keys(M)) if (RE.test(k)) console.log('  M.' + k, typeof M[k]);
console.log('--- package named exports matching');
for (const k of Object.keys(pkg)) if (RE.test(k)) console.log('  pkg.' + k, typeof pkg[k]);
console.log('--- classes with matching members');
for (const k of Object.keys(M)) {
  const v = M[k];
  if (typeof v !== 'function' || !v.prototype) continue;
  const own = [];
  let p = v.prototype;
  while (p && p !== Object.prototype) { own.push(...Object.getOwnPropertyNames(p)); p = Object.getPrototypeOf(p); }
  const hits = [...new Set(own)].filter((n) => RE.test(n));
  const stat = Object.getOwnPropertyNames(v).filter((n) => RE.test(n));
  if (hits.length || stat.length) console.log('  ' + k + ': members=' + hits.join(',') + ' statics=' + stat.join(','));
}
console.log('--- total class count', Object.keys(M).filter((k)=>typeof M[k]==='function'&&M[k].prototype).length);
