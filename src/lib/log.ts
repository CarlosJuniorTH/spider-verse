/**
 * log.ts — salida por consola homogénea.
 *
 * Incluye `action()`, que imprime el bloque obligatorio de CONTEXTO.md §2.4:
 * QUÉ · POR QUÉ · CUÁNTO CUESTA · DINERO REAL · REVERSIBLE.
 *
 * REGLA: ninguna función de este módulo debe imprimir jamás material secreto.
 * `redactSecret()` existe precisamente para no caer en la tentación de
 * "solo un trocito para depurar".
 */

const useColor = process.stdout.isTTY === true && process.env['NO_COLOR'] === undefined;

const c = {
  reset: useColor ? '\x1b[0m' : '',
  dim: useColor ? '\x1b[2m' : '',
  bold: useColor ? '\x1b[1m' : '',
  red: useColor ? '\x1b[31m' : '',
  green: useColor ? '\x1b[32m' : '',
  yellow: useColor ? '\x1b[33m' : '',
  blue: useColor ? '\x1b[34m' : '',
  magenta: useColor ? '\x1b[35m' : '',
  cyan: useColor ? '\x1b[36m' : '',
} as const;

export const log = {
  info(msg: string): void {
    console.log(`${c.blue}·${c.reset} ${msg}`);
  },
  ok(msg: string): void {
    console.log(`${c.green}✔${c.reset} ${msg}`);
  },
  warn(msg: string): void {
    console.log(`${c.yellow}⚠${c.reset} ${msg}`);
  },
  error(msg: string): void {
    console.error(`${c.red}✗${c.reset} ${msg}`);
  },
  /**
   * Como `error` pero por stdout. Se usa en informes (p. ej. el resumen de
   * `preflight`) donde mezclar stderr y stdout descoloca el orden de las líneas.
   */
  fail(msg: string): void {
    console.log(`${c.red}✗${c.reset} ${msg}`);
  },
  step(msg: string): void {
    console.log(`\n${c.bold}${c.cyan}▸ ${msg}${c.reset}`);
  },
  dim(msg: string): void {
    console.log(`${c.dim}${msg}${c.reset}`);
  },
  plain(msg = ''): void {
    console.log(msg);
  },
  kv(key: string, value: string): void {
    console.log(`  ${c.dim}${key.padEnd(26)}${c.reset} ${value}`);
  },
  rule(): void {
    console.log(`${c.dim}${'─'.repeat(72)}${c.reset}`);
  },
  title(msg: string): void {
    console.log('');
    console.log(`${c.bold}${msg}${c.reset}`);
    log.rule();
  },
};

export interface ActionReport {
  /** QUÉ se hace. */
  what: string;
  /** POR QUÉ se hace. */
  why: string;
  /** CUÁNTO cuesta (texto libre, p. ej. "0 SOL — solo lectura"). */
  cost: string;
  /** ¿Usa dinero real? */
  realMoney: boolean;
  /** ¿Es reversible? Texto explicando en qué sentido. */
  reversible: string;
  /** Red sobre la que actúa. */
  cluster?: string;
}

/**
 * Imprime el bloque de transparencia exigido por CONTEXTO.md §2.4.
 * Todo script debe llamarlo ANTES de hacer nada.
 */
export function action(report: ActionReport): void {
  log.title('ACCIÓN');
  log.kv('QUÉ', report.what);
  log.kv('POR QUÉ', report.why);
  log.kv('CUÁNTO CUESTA', report.cost);
  log.kv(
    'DINERO REAL',
    report.realMoney ? `${c.red}${c.bold}SÍ — requiere autorización${c.reset}` : `${c.green}NO${c.reset}`,
  );
  log.kv('REVERSIBLE', report.reversible);
  if (report.cluster !== undefined) log.kv('RED', report.cluster);
  log.rule();
}

/**
 * Devuelve un marcador fijo. NUNCA revela parte del secreto.
 * Se usa para que sea imposible "loguear la clave un momentito".
 */
export function redactSecret(_secret: unknown): string {
  return '«[REDACTADO — nunca se imprime material de clave privada]»';
}

export const colors = c;
