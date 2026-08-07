/**
 * preflight.ts — TODAS las comprobaciones de seguridad y coherencia.
 *
 * QUÉ:        ejecuta una batería de verificaciones locales y de solo lectura.
 * POR QUÉ:    CONTEXTO.md §6 — "debe abortar ante cualquier configuración
 *             peligrosa o inconsistente".
 * CUÁNTO:     0 SOL. Solo lecturas.
 * DINERO REAL: No.
 * REVERSIBLE: N/A — no modifica nada.
 *
 * Códigos de salida:  0 = todo correcto (puede haber avisos) · 1 = hay errores.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { log, colors } from '../src/lib/log.js';
import { env, envFileExists, envFilePath, REPO_ROOT, KEYS_DIR } from '../src/lib/env.js';
import { resolveCluster, getConnection, checkGenesisMatchesCluster, formatSol } from '../src/lib/cluster.js';
import { isInsideRepo, loadPublicKey } from '../src/lib/wallet.js';
import {
  validateProfile,
  profileNameFor,
  tokenConfig,
  totalSupplyBaseUnits,
  type ProfileName,
} from '../config/token.config.js';

type Level = 'ok' | 'warn' | 'error';

interface Result {
  level: Level;
  title: string;
  detail?: string;
}

const results: Result[] = [];
const ok = (title: string, detail?: string): void => void results.push({ level: 'ok', title, detail });
const warn = (title: string, detail?: string): void => void results.push({ level: 'warn', title, detail });
const fail = (title: string, detail?: string): void => void results.push({ level: 'error', title, detail });

// ── 1. Fichero .env ──────────────────────────────────────────────────────────

function checkEnvFile(): void {
  if (!envFileExists) {
    warn(
      'No existe `.env`',
      `Se están usando valores por defecto (CLUSTER=devnet, clave en ${KEYS_DIR}).\n` +
        '      Crea uno con:  copy .env.example .env',
    );
  } else {
    ok('`.env` presente', envFilePath);
  }

  // El propio módulo env.ts ya aborta si detecta secretos dentro del .env.
  ok('`.env` sin material de clave', 'Verificado por src/lib/env.ts al cargar');
}

// ── 2. .gitignore ────────────────────────────────────────────────────────────

const REQUIRED_IGNORES = ['.env', '*.key', 'id*.json', 'keypair*.json', '*.seed', '*.mnemonic', 'node_modules/'];

function checkGitignore(): void {
  const p = path.join(REPO_ROOT, '.gitignore');
  if (!fs.existsSync(p)) {
    fail('No hay `.gitignore`', 'Riesgo directo de commitear claves.');
    return;
  }
  const lines = fs
    .readFileSync(p, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim());

  const missing = REQUIRED_IGNORES.filter((needle) => !lines.includes(needle));
  if (missing.length > 0) {
    fail('`.gitignore` incompleto', `Faltan patrones: ${missing.join(', ')}`);
  } else {
    ok('`.gitignore` cubre los patrones de clave', REQUIRED_IGNORES.join(' · '));
  }
}

// ── 3. Nada sensible seguido por git ─────────────────────────────────────────

const DANGEROUS_TRACKED = /(^|\/)(\.env$|.*\.key$|id.*\.json$|keypair.*\.json$|wallet.*\.json$|.*\.seed$|.*\.mnemonic$)/i;

function checkGitTracked(): void {
  let tracked: string[];
  try {
    const out = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' });
    tracked = out.split(/\r?\n/).filter((l) => l.trim() !== '');
  } catch {
    warn('No se ha podido consultar git', 'No se ha verificado si hay secretos versionados.');
    return;
  }

  const offenders = tracked.filter((f) => DANGEROUS_TRACKED.test(f) && f !== '.env.example');
  if (offenders.length > 0) {
    fail(
      'Hay ficheros sensibles SEGUIDOS por git',
      offenders.map((f) => `      ${f}`).join('\n') +
        '\n      Sácalos del índice YA:  git rm --cached <fichero>\n' +
        '      Si llegaron a un commit, considera esas claves comprometidas.',
    );
  } else {
    ok('git no sigue ningún fichero sensible', `${tracked.length} ficheros versionados revisados`);
  }
}

// ── 4. Ubicación de la clave ─────────────────────────────────────────────────

function checkKeypairLocation(): boolean {
  const kp = env.KEYPAIR_PATH;

  if (isInsideRepo(kp)) {
    fail(
      'KEYPAIR_PATH apunta DENTRO del repositorio',
      `      ${kp}\n      Las claves deben vivir fuera. Sugerido: ${path.join(KEYS_DIR, 'devnet.json')}`,
    );
    return false;
  }
  ok('KEYPAIR_PATH está fuera del repositorio', kp);

  if (!fs.existsSync(kp)) {
    warn('Todavía no existe el fichero de clave', '      Genera uno con:  npm run wallet:new');
    return false;
  }

  try {
    const raw: unknown = JSON.parse(fs.readFileSync(kp, 'utf8'));
    if (!Array.isArray(raw) || raw.length !== 64) {
      fail('El fichero de clave no tiene formato de keypair', 'Debe ser un array JSON de 64 bytes.');
      return false;
    }
  } catch {
    fail('El fichero de clave no es JSON válido', kp);
    return false;
  }

  ok('Fichero de clave con formato válido', '(contenido nunca mostrado)');
  return true;
}

// ── 5. Los scripts no filtran secretos ───────────────────────────────────────

/**
 * Patrones que indican USO real de material secreto, no la mera mención de la
 * palabra. Buscar `/mnemonic/i` a secas daba falso positivo en `src/lib/env.ts`,
 * que precisamente contiene la lista de nombres prohibidos para detectarlos.
 */
const LEAK_PATTERNS: Array<{ re: RegExp; why: string }> = [
  { re: /console\.(log|info|warn|error|debug)\s*\([^)]*secretKey/i, why: 'imprime `secretKey`' },
  { re: /log\.(kv|info|ok|warn|fail|plain|dim|step)\s*\([^)]*secretKey/i, why: 'imprime `secretKey`' },
  { re: /JSON\.stringify\s*\(\s*keypair\b/i, why: 'serializa el keypair completo' },
  { re: /\bprocess\.stdout\.write\s*\([^)]*secretKey/i, why: 'escribe `secretKey` por stdout' },
  // Dependencias de derivación de seed phrase: aquí no se usan nunca (§2.2).
  { re: /from\s+['"]bip39['"]|require\(\s*['"]bip39['"]/, why: 'importa bip39 (seed phrases, prohibido §2.2)' },
  {
    re: /from\s+['"]ed25519-hd-key['"]|require\(\s*['"]ed25519-hd-key['"]/,
    why: 'importa ed25519-hd-key (derivación desde seed phrase, prohibido §2.2)',
  },
  {
    re: /\b(generateMnemonic|mnemonicToSeed(Sync)?|validateMnemonic)\s*\(/,
    why: 'llama a una API de seed phrases (prohibido §2.2)',
  },
];

function walkTs(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      walkTs(full, acc);
    } else if (entry.name.endsWith('.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

function checkNoSecretLeaks(): void {
  const files = [
    ...walkTs(path.join(REPO_ROOT, 'src')),
    ...walkTs(path.join(REPO_ROOT, 'scripts')),
    ...walkTs(path.join(REPO_ROOT, 'config')),
  ];

  const offenders: string[] = [];
  for (const file of files) {
    // El propio preflight contiene los patrones como texto; no se audita a sí mismo.
    if (path.basename(file) === 'preflight.ts') continue;
    const src = fs.readFileSync(file, 'utf8');
    for (const { re, why } of LEAK_PATTERNS) {
      if (re.test(src)) offenders.push(`${path.relative(REPO_ROOT, file)} — ${why}`);
    }
  }

  if (offenders.length > 0) {
    fail('Código que podría filtrar material de clave', offenders.map((o) => `      ${o}`).join('\n'));
  } else {
    ok('Ningún script imprime material de clave', `${files.length} ficheros .ts analizados`);
  }
}

// ── 6. Guardas de gasto ──────────────────────────────────────────────────────

function checkSpendGuards(): void {
  const cluster = resolveCluster();

  if (!cluster.isMainnet) {
    ok(`CLUSTER = ${cluster.name}`, 'Fase de desarrollo correcta: 0 € de coste (CONTEXTO.md §2.3)');
  } else {
    fail(
      'CLUSTER = mainnet-beta',
      '      Estamos en FASE 1. El desarrollo debe hacerse íntegramente en devnet.\n' +
        '      Pon CLUSTER=devnet en .env.',
    );
  }

  if (env.ALLOW_MAINNET || env.I_UNDERSTAND_THIS_SPENDS_REAL_MONEY) {
    fail(
      'Guardas de gasto DESACTIVADAS en .env',
      `      ALLOW_MAINNET=${env.ALLOW_MAINNET} · I_UNDERSTAND_THIS_SPENDS_REAL_MONEY=${env.I_UNDERSTAND_THIS_SPENDS_REAL_MONEY}\n` +
        '      Ambas deben ser false hasta la FASE 8 y solo con autorización explícita.',
    );
  } else {
    ok('Guardas de gasto activas', 'ALLOW_MAINNET=false · I_UNDERSTAND_THIS_SPENDS_REAL_MONEY=false');
  }
}

// ── 7. Configuración del token ───────────────────────────────────────────────

function checkTokenConfig(): void {
  // El perfil ACTIVO (el del cluster en uso) se valida en modo estricto: si vas a
  // usarlo, tiene que estar cerrado. El otro perfil solo se informa.
  const cluster = resolveCluster();
  const activeProfile = profileNameFor(cluster.name);
  const otherProfile: ProfileName = activeProfile === 'devnet' ? 'mainnet' : 'devnet';

  const activeIssues = validateProfile(activeProfile, true);
  const activeErrors = activeIssues.filter((i) => i.level === 'error');

  if (activeErrors.length > 0) {
    fail(
      `El perfil ACTIVO «${activeProfile}» tiene decisiones sin cerrar`,
      activeErrors.map((e) => `      - ${e.message}`).join('\n') +
        '\n      Con este perfil NO se puede crear el token.',
    );
  } else {
    const p = tokenConfig[activeProfile];
    ok(
      `Perfil activo «${activeProfile}» listo`,
      `${p.name} (${p.symbol}) · ${p.tokenProgram} · supply ${tokenConfig.totalSupply.toLocaleString('es-ES')} · ` +
        `${tokenConfig.decimals} decimales · ${totalSupplyBaseUnits().toString()} unidades base`,
    );
  }

  const activeWarns = activeIssues.filter((i) => i.level === 'warn');
  if (activeWarns.length > 0) {
    warn(
      `Avisos del perfil activo (${activeWarns.length})`,
      activeWarns.map((w) => `      - ${w.message}`).join('\n'),
    );
  }

  // El perfil de mainnet debe seguir BLOQUEADO mientras §4.4/§7.1/§7.3 sigan abiertos.
  const otherErrors = validateProfile(otherProfile, true).filter((i) => i.level === 'error');
  if (otherProfile === 'mainnet' && otherErrors.length > 0) {
    warn(
      `El perfil «mainnet» sigue BLOQUEADO (${otherErrors.length} decisiones abiertas)`,
      otherErrors.map((e) => `      - ${e.message}`).join('\n') +
        '\n      Es lo correcto: son decisiones del operador (§4.4, §7.1, §7.3), no del código.',
    );
  }
}

// ── 8. Comprobaciones contra la red (solo lectura) ───────────────────────────

async function checkNetwork(hasKey: boolean): Promise<void> {
  const cluster = resolveCluster();
  const connection = getConnection(cluster);

  let version: { 'solana-core': string };
  try {
    version = await connection.getVersion();
  } catch (err) {
    fail('RPC inalcanzable', `      ${cluster.endpoint}\n      ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  ok('RPC alcanzable', `${cluster.endpoint} · solana-core ${version['solana-core']}`);

  const genesis = await checkGenesisMatchesCluster(connection, cluster);
  if (genesis.ok) {
    ok('La red del RPC coincide con CLUSTER', genesis.message);
  } else {
    fail('LA RED DEL RPC NO COINCIDE CON CLUSTER', `      ${genesis.message}`);
  }

  if (!hasKey) return;

  const pubkey = loadPublicKey();
  const lamports = await connection.getBalance(pubkey, 'confirmed');
  if (lamports === 0) {
    warn('La wallet tiene saldo 0', `      ${pubkey.toBase58()}\n      Consigue SOL de prueba:  npm run airdrop`);
  } else {
    ok('Wallet con saldo', `${pubkey.toBase58()} — ${formatSol(lamports)}`);
  }
}

// ── Ejecución ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const cluster = resolveCluster();

  log.title('PREFLIGHT — comprobaciones de seguridad y coherencia');
  log.kv('QUÉ', 'Auditar configuración, claves, git, tokenómica y red');
  log.kv('POR QUÉ', 'Abortar antes de que una configuración peligrosa cause daño (§6)');
  log.kv('CUÁNTO CUESTA', '0 SOL — solo lecturas, no se firma nada');
  log.kv('DINERO REAL', `${colors.green}NO${colors.reset}`);
  log.kv('REVERSIBLE', 'N/A — no modifica nada');
  log.kv('RED', `${cluster.name} → ${cluster.endpoint}`);

  checkEnvFile();
  checkGitignore();
  checkGitTracked();
  const hasKey = checkKeypairLocation();
  checkNoSecretLeaks();
  checkSpendGuards();
  checkTokenConfig();
  await checkNetwork(hasKey);

  log.title('RESULTADOS');
  for (const r of results) {
    // Todo el informe va por stdout: mezclar stderr descoloca el orden de las líneas.
    if (r.level === 'ok') log.ok(r.title);
    else if (r.level === 'warn') log.warn(r.title);
    else log.fail(r.title);
    if (r.detail !== undefined) log.dim(r.detail.startsWith('      ') ? r.detail : `      ${r.detail}`);
  }

  const errors = results.filter((r) => r.level === 'error').length;
  const warns = results.filter((r) => r.level === 'warn').length;
  const oks = results.filter((r) => r.level === 'ok').length;

  log.title('VEREDICTO');
  log.kv('Correctas', String(oks));
  log.kv('Avisos', String(warns));
  log.kv('Errores', String(errors));
  log.plain('');

  if (errors > 0) {
    log.fail(`PREFLIGHT FALLIDO: ${errors} error(es). No continúes hasta corregirlos.`);
    process.exitCode = 1;
    return;
  }
  log.ok(`PREFLIGHT SUPERADO${warns > 0 ? ` (con ${warns} aviso(s))` : ''}. 0 € gastados.`);
}

main().catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
