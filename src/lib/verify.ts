/**
 * verify.ts — comprobaciones públicas del token. FASE 4.
 *
 * Filosofía: **contrastar lo que decimos contra lo que hay en la cadena.**
 * Nada de esto lee el artefacto local para dar por bueno un valor; todo se
 * relee de Solana. Cualquiera puede ejecutarlo contra nuestro mint (o contra
 * el de otro proyecto) y obtener el mismo resultado. Eso es la transparencia
 * del §1: no pedir confianza, dar herramientas de comprobación.
 *
 * Los criterios de "riesgo" reflejan lo que miran los analizadores automáticos
 * (RugCheck, Bubblemaps, la pestaña de holders de DexScreener, Birdeye).
 */

import type { Connection } from '@solana/web3.js';
import { readMint, readMetadata, readTopHolders, formatAmount, type MintState } from './inspect.js';
import { log } from './log.js';
import { tokenConfig, profileFor, totalSupplyBaseUnits } from '../../config/token.config.js';

export interface Check {
  level: 'ok' | 'warn' | 'error';
  title: string;
  detail?: string;
}

const ok = (title: string, detail?: string): Check => ({ level: 'ok', title, detail });
const warn = (title: string, detail?: string): Check => ({ level: 'warn', title, detail });
const bad = (title: string, detail?: string): Check => ({ level: 'error', title, detail });

// ── Supply ───────────────────────────────────────────────────────────────────

/**
 * `ours` = el mint es un despliegue nuestro. Solo entonces tiene sentido
 * contrastarlo con `token.config.ts`; contra un token ajeno solo se informa.
 */
export async function checkSupply(
  connection: Connection,
  mintAddress: string,
  cluster: string,
  ours = true,
): Promise<Check[]> {
  const mint = await readMint(connection, mintAddress);
  const expected = totalSupplyBaseUnits();
  const checks: Check[] = [];

  checks.push(ok('El mint existe y está inicializado', `${mint.address} · programa ${mint.programName}`));

  if (!ours) {
    checks.push(ok(`decimals = ${mint.decimals}`, 'token ajeno: no se compara con nuestra configuración'));
    checks.push(
      mint.supply === 0n
        ? warn('El supply es 0')
        : ok(`Supply = ${formatAmount(mint.supply, mint.decimals)}`, `${mint.supply} unidades base`),
    );
  } else {
    if (mint.decimals === tokenConfig.decimals) {
      checks.push(ok(`decimals = ${mint.decimals}`, 'coincide con la configuración'));
    } else {
      checks.push(
        bad(`decimals = ${mint.decimals} pero la configuración dice ${tokenConfig.decimals}`, 'inconsistencia grave'),
      );
    }

    if (mint.supply === 0n) {
      checks.push(bad('El supply es 0', 'no se ha acuñado nada todavía'));
    } else if (mint.supply === expected) {
      checks.push(
        ok(
          `Supply = ${formatAmount(mint.supply, mint.decimals)}`,
          `coincide exactamente con lo configurado (${expected} unidades base)`,
        ),
      );
    } else {
      checks.push(
        warn(
          `Supply = ${formatAmount(mint.supply, mint.decimals)}, configurado ${formatAmount(expected, mint.decimals)}`,
          'no coinciden. Puede ser legítimo (acuñación parcial) o un error. Revisar.',
        ),
      );
    }
  }

  if (mint.mintAuthority === null) {
    checks.push(ok('El supply es FIJO', 'mintAuthority revocada: nadie puede acuñar más'));
  } else {
    checks.push(
      warn(
        'El supply NO es fijo todavía',
        `mintAuthority = ${mint.mintAuthority}. Mientras siga viva se pueden acuñar tokens ` +
          'y los analizadores lo marcan como riesgo de dilución.',
      ),
    );
  }

  void cluster;
  return checks;
}

// ── Autoridades ──────────────────────────────────────────────────────────────

export async function checkAuthorities(connection: Connection, mintAddress: string): Promise<Check[]> {
  const mint = await readMint(connection, mintAddress);
  const meta = await readMetadata(connection, mintAddress);
  const checks: Check[] = [];

  // freezeAuthority: la más importante para descartar honeypot (§2.1)
  if (mint.freezeAuthority === null) {
    checks.push(
      ok('freezeAuthority: REVOCADA', 'nadie puede congelar cuentas ni bloquear ventas. Esto descarta el honeypot.'),
    );
  } else {
    checks.push(
      bad(
        'freezeAuthority: ACTIVA',
        `${mint.freezeAuthority} puede congelar cualquier cuenta y bloquear ventas. ` +
          'Es exactamente el mecanismo que §2.1 prohíbe. Los analizadores lo marcan en rojo.',
      ),
    );
  }

  if (mint.mintAuthority === null) {
    checks.push(ok('mintAuthority: REVOCADA', 'el supply no se puede diluir'));
  } else {
    checks.push(
      warn(
        'mintAuthority: ACTIVA',
        `${mint.mintAuthority} puede acuñar tokens nuevos. Legítimo antes de terminar el ` +
          'despliegue; un riesgo si el token ya cotiza.',
      ),
    );
  }

  if (!meta.exists) {
    checks.push(bad('No hay cuenta de metadata', 'el token aparecerá como "Unknown Token"'));
  } else if (meta.updateAuthority === null) {
    checks.push(ok('updateAuthority: REVOCADA', 'la metadata está congelada y no se puede cambiar'));
  } else {
    checks.push(
      warn(
        'updateAuthority: ACTIVA',
        `${meta.updateAuthority} puede cambiar nombre, símbolo, imagen y URI. ` +
          'Imprescindible mientras se corrige la metadata; conviene revocarla al terminar.',
      ),
    );
  }

  if (meta.exists && meta.isMutable === false && meta.updateAuthority !== null) {
    checks.push(warn('isMutable = false pero updateAuthority sigue puesta', 'estado incoherente, revisar'));
  }

  return checks;
}

// ── Metadata ─────────────────────────────────────────────────────────────────

async function fetchJson(url: string, timeoutMs = 10_000): Promise<{ ok: boolean; status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* no era JSON */
    }
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkMetadata(
  connection: Connection,
  mintAddress: string,
  cluster: string,
  ours = true,
): Promise<Check[]> {
  const meta = await readMetadata(connection, mintAddress);
  const profile = profileFor(cluster);
  const checks: Check[] = [];

  if (!meta.exists) {
    return [
      bad(
        'No existe cuenta de metadata para este mint',
        'Sin ella el token no tiene nombre, símbolo ni logo en wallets ni agregadores. ' +
          'Ejecuta:  npm run metadata:attach',
      ),
    ];
  }

  checks.push(ok('Cuenta de metadata presente', `${meta.accountSize} bytes`));

  if (!ours) {
    checks.push(ok(`name = "${meta.name}" · symbol = "${meta.symbol}"`, 'token ajeno: no se compara con la config'));
  } else {
    if (meta.name === profile.name) {
      checks.push(ok(`name = "${meta.name}"`, 'coincide con la configuración'));
    } else {
      checks.push(warn(`name on-chain = "${meta.name}"`, `la configuración dice "${profile.name}"`));
    }

    if (meta.symbol === profile.symbol) {
      checks.push(ok(`symbol = "${meta.symbol}"`, 'coincide con la configuración'));
    } else {
      checks.push(warn(`symbol on-chain = "${meta.symbol}"`, `la configuración dice "${profile.symbol}"`));
    }
  }

  if (meta.sellerFeeBasisPoints === 0) {
    checks.push(ok('sellerFeeBasisPoints = 0', 'sin royalties de creador'));
  } else {
    checks.push(warn(`sellerFeeBasisPoints = ${meta.sellerFeeBasisPoints}`, 'hay royalties configuradas'));
  }

  // ── La URI: aquí es donde falla la mayoría de tokens ──────────────────────
  if (meta.uri === null || meta.uri === '') {
    checks.push(bad('La URI está vacía', 'el token no tendrá logo ni descripción'));
    return checks;
  }

  checks.push(ok('URI presente', meta.uri));

  if (/^PENDIENTE/i.test(meta.uri)) {
    checks.push(bad('La URI es un marcador de posición', 'hay que subir la metadata y actualizarla'));
    return checks;
  }

  if (meta.uri.startsWith('ipfs://')) {
    checks.push(
      warn('URI ipfs://', 'muchas wallets la resuelven, otras no. Una URL https de gateway es más compatible.'),
    );
    return checks;
  }

  try {
    const res = await fetchJson(meta.uri);
    if (!res.ok) {
      checks.push(bad(`La URI responde HTTP ${res.status}`, 'el logo y la descripción NO se verán'));
      return checks;
    }
    checks.push(ok('La URI resuelve correctamente', `HTTP ${res.status}`));

    const body = res.body;
    if (typeof body !== 'object' || body === null) {
      checks.push(bad('La URI no devuelve un JSON válido'));
      return checks;
    }

    const json = body as Record<string, unknown>;
    if (json['name'] !== meta.name) {
      checks.push(warn('El "name" del JSON no coincide con el on-chain', `JSON="${String(json['name'])}"`));
    } else {
      checks.push(ok('El "name" del JSON coincide con el on-chain'));
    }

    const image = json['image'];
    if (typeof image !== 'string' || image === '') {
      checks.push(bad('El JSON no tiene campo "image"', 'el token se verá sin logo'));
    } else if (/^PENDIENTE/i.test(image)) {
      checks.push(bad('El campo "image" es un marcador de posición', image));
    } else {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        const imgRes = await fetch(image, { method: 'HEAD', signal: controller.signal });
        clearTimeout(timer);
        if (imgRes.ok) {
          checks.push(ok('La imagen es accesible', `HTTP ${imgRes.status} · ${image}`));
        } else {
          checks.push(bad(`La imagen responde HTTP ${imgRes.status}`, image));
        }
      } catch (err) {
        checks.push(warn('No se ha podido comprobar la imagen', err instanceof Error ? err.message : String(err)));
      }
    }
  } catch (err) {
    checks.push(
      bad('No se ha podido descargar la URI', `${err instanceof Error ? err.message : String(err)} — ${meta.uri}`),
    );
  }

  return checks;
}

// ── Distribución ─────────────────────────────────────────────────────────────

export interface DistributionResult {
  checks: Check[];
  mint: MintState;
  holders: Awaited<ReturnType<typeof readTopHolders>>;
}

export async function checkDistribution(connection: Connection, mintAddress: string): Promise<DistributionResult> {
  const mint = await readMint(connection, mintAddress);

  // `getTokenLargestAccounts` es una llamada cara y los RPC públicos la limitan
  // ("Too many requests for a specific RPC call"). Que falle es un contratiempo,
  // no un motivo para tumbar el informe entero: se degrada con un aviso.
  let holders: Awaited<ReturnType<typeof readTopHolders>>;
  try {
    holders = await readTopHolders(connection, mintAddress, mint.supply);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const throttled = /429|Too many requests/i.test(msg);
    return {
      checks: [
        warn(
          throttled
            ? 'El RPC ha limitado la consulta de tenedores (429)'
            : 'No se ha podido consultar la distribución',
          throttled
            ? 'Los RPC públicos restringen getTokenLargestAccounts. La distribución NO se ha comprobado. ' +
              'Reintenta en unos minutos o usa un RPC propio (tier gratuito) en RPC_URL.'
            : msg,
        ),
      ],
      mint,
      holders: [],
    };
  }

  const checks: Check[] = [];

  if (holders.length === 0) {
    return { checks: [bad('No hay ninguna cuenta con tokens')], mint, holders };
  }

  const top1 = holders[0];
  const top10 = holders.slice(0, 10).reduce((a, h) => a + h.percent, 0);

  checks.push(ok(`${holders.length} cuenta(s) con saldo`, 'getTokenLargestAccounts devuelve como máximo 20'));

  if (top1 !== undefined) {
    const detail = `${top1.owner ?? top1.tokenAccount} tiene ${top1.percent.toFixed(2)}%`;
    if (top1.percent >= 90) {
      checks.push(
        warn(
          `Concentración máxima: ${top1.percent.toFixed(2)}% en una sola cuenta`,
          `${detail}. Normal antes de crear liquidez; inaceptable con el token ya cotizando.`,
        ),
      );
    } else if (top1.percent >= 20) {
      checks.push(warn(`El mayor tenedor concentra ${top1.percent.toFixed(2)}%`, detail));
    } else {
      checks.push(ok(`El mayor tenedor concentra ${top1.percent.toFixed(2)}%`, detail));
    }
  }

  checks.push(
    top10 >= 90
      ? warn(`Top 10 = ${top10.toFixed(2)}% del supply`, 'concentración muy alta')
      : ok(`Top 10 = ${top10.toFixed(2)}% del supply`),
  );

  // §2.1: la parte del fundador debe ser UNA wallet identificable, no varias.
  const owners = holders.map((h) => h.owner).filter((o): o is string => o !== null);
  const uniqueOwners = new Set(owners);
  if (owners.length > 0 && uniqueOwners.size < owners.length) {
    checks.push(
      warn(
        'Un mismo propietario aparece en varias token accounts',
        'Puede ser normal, pero conviene revisarlo: §2.1 prohíbe trocear la asignación para disimular.',
      ),
    );
  }

  return { checks, mint, holders };
}

// ── Presentación ─────────────────────────────────────────────────────────────

/** Imprime un bloque de comprobaciones. Todo por stdout, para no descolocar el orden. */
export function printChecks(title: string, checks: Check[]): void {
  log.title(title);
  for (const c of checks) {
    if (c.level === 'ok') log.ok(c.title);
    else if (c.level === 'warn') log.warn(c.title);
    else log.fail(c.title);
    if (c.detail !== undefined) log.dim(`      ${c.detail}`);
  }
}

export interface Summary {
  ok: number;
  warn: number;
  error: number;
}

export function summarize(checks: Check[]): Summary {
  return {
    ok: checks.filter((c) => c.level === 'ok').length,
    warn: checks.filter((c) => c.level === 'warn').length,
    error: checks.filter((c) => c.level === 'error').length,
  };
}

/**
 * Imprime el veredicto y ajusta el código de salida.
 * `strict` = los avisos también hacen fallar (se usa en el chequeo previo a mainnet).
 */
export function verdict(checks: Check[], strict = false): void {
  const s = summarize(checks);
  log.title('VEREDICTO');
  log.kv('Correctas', String(s.ok));
  log.kv('Avisos', String(s.warn));
  log.kv('Errores', String(s.error));
  log.plain('');

  if (s.error > 0) {
    log.fail(`${s.error} comprobación(es) FALLIDA(S).`);
    process.exitCode = 1;
  } else if (strict && s.warn > 0) {
    log.fail(`Sin errores, pero ${s.warn} aviso(s) y el modo estricto no los tolera.`);
    process.exitCode = 1;
  } else {
    log.ok(`Verificación superada${s.warn > 0 ? ` (con ${s.warn} aviso(s))` : ''}. 0 € gastados.`);
  }
}
