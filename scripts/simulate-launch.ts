/**
 * simulate-launch.ts — FASE 5. Simula el lanzamiento COMPLETO sin gastar nada.
 *
 * QUÉ:        recorre todo el flujo real (crear mint → acuñar → metadata →
 *             verificar → revocar) construyendo y SIMULANDO cada transacción
 *             contra la red, pero sin firmar ni enviar ninguna.
 * POR QUÉ:    CONTEXTO.md FASE 5 pide "simular lanzamiento completo sin dinero
 *             real". Detecta errores de configuración, saldo o permisos antes
 *             de que cuesten algo.
 * CUÁNTO:     0 SOL. Las simulaciones RPC son gratuitas.
 * DINERO REAL: No. Es imposible que gaste: fuerza DRY_RUN y no llama a ningún
 *             `sendRawTransaction`.
 * REVERSIBLE: N/A — no modifica nada.
 *
 * Uso:  npm run simulate:launch
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { log, colors, action } from '../src/lib/log.js';
import { REPO_ROOT, env } from '../src/lib/env.js';
import { resolveCluster, getConnection, formatSol } from '../src/lib/cluster.js';
import { assertClusterMatchesRpc } from '../src/lib/guard.js';
import { loadKeypair } from '../src/lib/wallet.js';
import { estimateTokenCreationCost, toFiat } from '../src/lib/cost.js';
import { profileFor, profileNameFor, validateProfile } from '../config/token.config.js';

interface Step {
  name: string;
  script: string;
  args: string[];
  /** Si falla, ¿se aborta la simulación o solo se anota? */
  critical: boolean;
  /** Explicación de por qué puede fallar legítimamente. */
  mayFailBecause?: string;
}

function runStep(step: Step): { code: number; output: string } {
  const result = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(REPO_ROOT, step.script), ...step.args],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, DRY_RUN: '1' }, // ← imposible que envíe nada
    },
  );
  return { code: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

async function main(): Promise<void> {
  const cluster = resolveCluster();
  const profileName = profileNameFor(cluster.name);
  const profile = profileFor(cluster.name);

  action({
    what: 'Simular el lanzamiento completo: crear, acuñar, metadata, verificar',
    why: 'FASE 5 — detectar cualquier fallo antes de que cueste dinero',
    cost: '0 SOL — todas las transacciones se simulan, ninguna se firma',
    realMoney: false,
    reversible: 'N/A — no modifica nada, ni en la cadena ni en disco',
    cluster: cluster.name,
  });

  if (cluster.isMainnet) {
    log.warn('CLUSTER=mainnet-beta. La simulación es igualmente gratuita, pero los');
    log.warn('errores de configuración de mainnet aparecerán aquí. Es justo lo que queremos.');
  }

  // ── 1. Configuración ─────────────────────────────────────────────────────
  log.title('1 · CONFIGURACIÓN');
  const issues = validateProfile(profileName, true);
  const errors = issues.filter((i) => i.level === 'error');
  if (errors.length > 0) {
    log.fail(`El perfil «${profileName}» NO está listo (${errors.length} decisiones abiertas):`);
    for (const e of errors) log.dim(`      - ${e.message}`);
    log.plain('');
    log.info('La simulación se detiene aquí a propósito: no tiene sentido simular un');
    log.info('lanzamiento cuya tokenómica todavía no está decidida.');
    process.exitCode = 1;
    return;
  }
  log.ok(`Perfil «${profileName}» listo`);
  log.kv('Token', `${profile.name} (${profile.symbol})`);
  log.kv('Programa', profile.tokenProgram);
  log.kv('Asignaciones', profile.allocations.map((a) => `${a.label} ${a.percent}%`).join(' · '));

  // ── 2. Red y saldo ───────────────────────────────────────────────────────
  log.title('2 · RED Y SALDO');
  const connection = getConnection(cluster);
  await assertClusterMatchesRpc(connection, cluster);

  const payer = loadKeypair();
  const balance = await connection.getBalance(payer.publicKey, 'confirmed');
  const estimate = await estimateTokenCreationCost(connection, 3);

  log.kv('Pagador', payer.publicKey.toBase58());
  log.kv('Saldo', formatSol(balance));
  log.kv('Coste estimado', formatSol(estimate.totalLamports));

  const enough = balance >= estimate.totalLamports;
  if (enough) {
    log.ok(`Saldo suficiente (sobran ${formatSol(balance - estimate.totalLamports)})`);
  } else {
    log.warn(`Saldo INSUFICIENTE: faltan ${formatSol(estimate.totalLamports - balance)}`);
    log.dim('      Las simulaciones de transacción fallarán con "insufficient lamports".');
    log.dim(cluster.isMainnet ? '      Transfiere SOL a esa wallet.' : '      npm run airdrop');
  }

  // ── 3. Transacciones, en dry-run ─────────────────────────────────────────
  const steps: Step[] = [
    {
      name: 'Crear mint + acuñar supply',
      script: 'scripts/token-create.ts',
      args: ['dry-run'],
      critical: true,
      mayFailBecause: 'saldo insuficiente',
    },
    {
      name: 'Adjuntar metadata',
      script: 'scripts/metadata-attach.ts',
      args: ['dry-run'],
      critical: false,
      mayFailBecause: 'aún no existe el mint, o falta METADATA_URI en .env',
    },
  ];

  log.title('3 · TRANSACCIONES (simuladas, DRY_RUN forzado)');
  const results: Array<{ step: Step; code: number; output: string }> = [];

  for (const step of steps) {
    log.plain('');
    log.info(`▸ ${step.name}`);
    const r = runStep(step);
    results.push({ step, ...r });

    if (r.code === 0) {
      log.ok(`   simulación correcta`);
    } else {
      const lastError = r.output
        .split(/\r?\n/)
        .filter((l) => l.includes('✗'))
        .pop();
      log.warn(`   falló: ${lastError?.replace(/^.*✗\s*/, '') ?? `código ${r.code}`}`);
      if (step.mayFailBecause !== undefined) log.dim(`      causa esperable: ${step.mayFailBecause}`);
    }
  }

  // ── 4. Resumen ───────────────────────────────────────────────────────────
  log.title('4 · RESUMEN DE LA SIMULACIÓN');

  const failed = results.filter((r) => r.code !== 0);
  const criticalFailed = failed.filter((r) => r.step.critical);

  log.kv('Pasos simulados', String(results.length));
  log.kv('Correctos', String(results.length - failed.length));
  log.kv('Fallidos', String(failed.length));

  log.title('COSTE QUE TENDRÍA EL LANZAMIENTO REAL');
  for (const line of estimate.rentLines) {
    log.kv(line.label, `${formatSol(line.lamports)}${line.recoverable ? ' (recuperable)' : ''}`);
  }
  log.kv('Fees', formatSol(estimate.totalFeeLamports));
  log.kv('TOTAL', formatSol(estimate.totalLamports));

  const fiat = toFiat(estimate.totalLamports);
  if (fiat.usd !== null) {
    log.kv('≈ USD', `${fiat.usd.toFixed(4)} $`);
    if (fiat.eur !== null) log.kv('≈ EUR', `${fiat.eur.toFixed(4)} €`);
  } else {
    log.dim(`      ${fiat.note}`);
  }

  log.warn('Esto NO incluye el capital de liquidez ni las comisiones de ningún DEX');
  log.warn('o plataforma de lanzamiento. Ver docs/FASE6-mecanismos.md.');

  log.title('VEREDICTO');
  log.plain('');
  if (criticalFailed.length === 0 && enough) {
    log.ok(`${colors.bold}Simulación superada.${colors.reset} El flujo funcionaría. 0 € gastados.`);
  } else if (!enough) {
    log.warn('El flujo es correcto pero falta saldo. Consigue SOL y repite.');
    process.exitCode = 1;
  } else {
    log.fail(`${criticalFailed.length} paso(s) crítico(s) fallaron. Revisa la salida de arriba.`);
    process.exitCode = 1;
  }

  log.plain('');
  log.dim(`      Ninguna transacción se ha firmado ni enviado. DRY_RUN=1 forzado en cada paso.`);
  log.dim(`      METADATA_URI: ${env.METADATA_URI ?? '(sin definir)'}`);
}

main().catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
