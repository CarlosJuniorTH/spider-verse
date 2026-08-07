/**
 * args.ts — lectura de opciones de línea de comandos.
 *
 * ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────
 * npm 12 **rechaza los flags que no conoce**: `npm run x -- --dry-run` falla con
 * `EUNKNOWNCONFIG` antes de llegar al script. Pero sí deja pasar los argumentos
 * que no empiezan por guion.
 *
 * Así que cada opción se puede dar de tres formas equivalentes:
 *
 *   npm run token:create -- dry-run            ← funciona con npm (recomendado)
 *   npx tsx scripts/token-create.ts --dry-run  ← forma clásica con guiones
 *   DRY_RUN=1 npm run token:create             ← variable de entorno
 *
 * Y con valor:
 *   npm run budget:mainnet -- pool-sol=0.2
 *   npx tsx scripts/budget-mainnet.ts --pool-sol 0.2
 */

const argv = process.argv.slice(2);

/** `pool-sol` → `POOL_SOL` */
function envName(name: string): string {
  return name.replace(/-/g, '_').toUpperCase();
}

/** ¿Está presente esta opción booleana? */
export function hasFlag(name: string): boolean {
  if (argv.includes(`--${name}`) || argv.includes(name)) return true;
  const v = process.env[envName(name)];
  return v === '1' || v?.toLowerCase() === 'true';
}

/** Valor de una opción, o null si no se ha dado. */
export function option(name: string): string | null {
  for (const form of [`--${name}`, name]) {
    // forma `nombre=valor`
    const eq = argv.find((a) => a.startsWith(`${form}=`));
    if (eq !== undefined) return eq.slice(form.length + 1);

    // forma `nombre valor`
    const i = argv.indexOf(form);
    if (i !== -1) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-') && !next.includes('=')) return next;
    }
  }
  const env = process.env[envName(name)];
  return env !== undefined && env.trim() !== '' ? env.trim() : null;
}

/** Valor numérico no negativo, o null. */
export function numberOption(name: string): number | null {
  const raw = option(name);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Argumentos sueltos (los que no son opciones): se usa para la dirección del
 * mint. Descarta los guiones y cualquier `clave=valor`, y también las palabras
 * que son nombres de opción conocidos.
 */
export function positionals(knownFlags: string[] = []): string[] {
  const known = new Set(knownFlags);
  const out: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a.startsWith('-') || a.includes('=')) continue;
    if (known.has(a)) continue;
    // valor de una opción del tipo `--nombre valor`
    const prev = argv[i - 1];
    if (prev !== undefined && (prev.startsWith('--') || known.has(prev))) continue;
    out.push(a);
  }
  return out;
}

/** Nombres de opción que usan los scripts. Sirven para no confundirlos con un mint. */
export const KNOWN_FLAGS = ['dry-run', 'strict', 'mint', 'update', 'pool-sol', 'liquidity-sol', 'sol-usd', 'eur-usd'];
