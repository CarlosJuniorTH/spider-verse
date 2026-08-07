/**
 * metadata-build.ts — genera `assets/metadata.json` (el JSON off-chain del token).
 *
 * QUÉ:        compone el JSON estándar de metadata a partir de token.config.ts.
 * POR QUÉ:    la cuenta de metadata on-chain solo guarda una URI; el contenido
 *             (descripción, imagen, enlaces) vive en ese JSON. §4.5.
 * CUÁNTO:     0 SOL. Es un fichero local.
 * DINERO REAL: No.
 * REVERSIBLE: Sí — se regenera cuando quieras.
 *
 * ── §4.5 HOSTING SIN SERVIDOR ────────────────────────────────────────────────
 * El operador no quiere dominio, web, backend ni base de datos. Dos opciones,
 * ambas de 0 €, y este script deja el fichero listo para las dos:
 *
 *   A) GitHub raw  — subes el repo (o solo `assets/`) a un repositorio público
 *      y usas `https://raw.githubusercontent.com/<user>/<repo>/<rama>/assets/metadata.json`.
 *      Gratis y sin cuenta nueva si ya tienes GitHub. Contra: si borras el repo,
 *      la metadata muere. Centralizado.
 *
 *   B) IPFS con tier gratuito (Pinata / web3.storage) — descentralizado y es lo
 *      que espera el ecosistema. Contra: hay que crear una cuenta, y el
 *      "pinning" gratuito no es eterno si nadie más replica el contenido.
 *
 * Este script NO sube nada a ningún sitio: subir contenido es una acción hacia
 * fuera y la decides tú. Solo genera el fichero e imprime los pasos.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { action, log } from '../src/lib/log.js';
import { REPO_ROOT } from '../src/lib/env.js';
import { resolveCluster } from '../src/lib/cluster.js';
import { tokenConfig, profileFor, profileNameFor } from '../config/token.config.js';

/** Estructura estándar que leen wallets y agregadores. */
interface TokenMetadataJson {
  name: string;
  symbol: string;
  description: string;
  image: string;
  external_url?: string;
  properties: {
    files: Array<{ uri: string; type: string }>;
    category: string;
  };
  extensions?: Record<string, string>;
}

/** Intenta derivar la URL raw de GitHub desde el remoto configurado. */
function deriveGithubRawUrl(file: string): string | null {
  let remote: string;
  try {
    remote = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }

  const m = /github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/.exec(remote);
  if (m === null) return null;

  let branch = 'main';
  try {
    branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    /* se queda en main */
  }

  return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${branch}/${file}`;
}

async function main(): Promise<void> {
  const cluster = resolveCluster();
  const profileName = profileNameFor(cluster.name);
  const profile = profileFor(cluster.name);

  action({
    what: `Generar assets/metadata.json para el perfil «${profileName}»`,
    why: 'La cuenta de metadata on-chain solo guarda una URI; el contenido vive en este JSON (§4.5)',
    cost: '0 SOL — fichero local, no toca la red',
    realMoney: false,
    reversible: 'Sí — se regenera cuando quieras',
    cluster: cluster.name,
  });

  // ── Imagen con nombre derivado de su CONTENIDO ────────────────────────────
  //
  // POR QUÉ: los exploradores y agregadores cachean las imágenes POR URL, de
  // forma agresiva y durante mucho tiempo. Si reutilizas `logo.png` para una
  // imagen distinta, siguen mostrando la vieja. Comprobado en la práctica:
  // Solscan mostró el logo anterior con el nombre nuevo.
  //
  // En mainnet esto es grave: si lanzas con el logo equivocado y después
  // revocas `updateAuthority` (§7.3), te quedas con él PARA SIEMPRE.
  //
  // Solución: el nombre del fichero incluye un hash de su contenido. Cambiar la
  // imagen cambia la URL, así que ninguna caché puede servir la antigua.
  const sourceImage = path.join(REPO_ROOT, profile.metadata.imageFile);
  let publishedImageFile = profile.metadata.imageFile;

  if (fs.existsSync(sourceImage)) {
    const bytes = fs.readFileSync(sourceImage);
    const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 10);
    const ext = path.extname(profile.metadata.imageFile);
    const dir = path.dirname(profile.metadata.imageFile);
    publishedImageFile = path.posix.join(dir.replace(/\\/g, '/'), `logo.${hash}${ext}`);

    const target = path.join(REPO_ROOT, publishedImageFile);
    if (!fs.existsSync(target)) fs.writeFileSync(target, bytes);
  }

  const imageUrlEnv = process.env['IMAGE_URI'];
  const imageRaw = deriveGithubRawUrl(publishedImageFile);
  const image = imageUrlEnv ?? imageRaw ?? `PENDIENTE://sube ${publishedImageFile} y pon aquí su URL`;

  const json: TokenMetadataJson = {
    name: profile.name,
    symbol: profile.symbol,
    description: profile.description,
    image,
    properties: {
      files: [{ uri: image, type: 'image/png' }],
      category: 'image',
    },
  };
  if (profile.metadata.externalUrl !== null) json.external_url = profile.metadata.externalUrl;

  // `extensions`: el campo estándar donde wallets y exploradores buscan los
  // enlaces del proyecto. Solo se incluyen los que estén definidos: un campo
  // vacío o un enlace muerto es peor que su ausencia.
  const socials = Object.entries(profile.metadata.socials).filter(
    (entry): entry is [string, string] => entry[1] !== null && entry[1] !== '',
  );
  if (socials.length > 0) json.extensions = Object.fromEntries(socials);

  const outPath = path.join(REPO_ROOT, 'assets', 'metadata.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(json, null, 2)}\n`, 'utf8');

  log.ok('Fichero generado.');
  log.kv('Ruta', outPath);
  log.kv('name / symbol', `${json.name} / ${json.symbol}`);
  log.kv('decimals', String(tokenConfig.decimals));
  log.kv('image', json.image);

  // ── Estado de la imagen ────────────────────────────────────────────────────
  const imagePath = sourceImage;
  log.title('Imagen');
  if (fs.existsSync(imagePath)) {
    const size = fs.statSync(imagePath).size;
    log.ok(`${profile.metadata.imageFile} presente (${(size / 1024).toFixed(1)} KB)`);
    log.kv('Se publica como', publishedImageFile);
    log.dim('      El nombre incluye un hash del contenido: si cambias la imagen cambia la URL,');
    log.dim('      y así ninguna caché de explorador puede seguir sirviendo la anterior.');
    if (size > 200 * 1024) {
      log.warn('Pesa más de 200 KB. Muchos agregadores la reescalan; conviene optimizarla.');
    }
  } else {
    log.warn(`Falta ${profile.metadata.imageFile}. El token funcionará, pero se verá sin logo.`);
    log.info('Formato recomendado: PNG cuadrado, 512×512 px, fondo transparente o sólido.');
  }

  // ── Enlaces del proyecto ───────────────────────────────────────────────────
  log.title('Enlaces públicos (campo `extensions`)');
  if (socials.length === 0) {
    log.warn('Ninguno definido. El token no apunta a ningún sitio.');
    log.dim('      Sin enlaces, quien lo encuentre no tiene forma de saber qué es ni quién');
    log.dim('      está detrás, y no hay nada que mirar antes de decidir. Se configuran en');
    log.dim('      config/token.config.ts → metadata.socials');
    log.dim('      Aviso honesto: tener enlaces es NECESARIO, no suficiente. Un enlace a una');
    log.dim('      cuenta vacía no ayuda; puede restar.');
  } else {
    for (const [k, v] of socials) log.kv(k, v);
    log.info('Comprobando que responden…');
    for (const [k, v] of socials) {
      if (!/^https?:\/\//.test(v)) {
        log.warn(`${k}: "${v}" no es una URL http(s)`);
        continue;
      }
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        const res = await fetch(v, { method: 'HEAD', signal: controller.signal });
        clearTimeout(timer);
        if (res.ok) log.ok(`${k}: HTTP ${res.status}`);
        else log.warn(`${k}: HTTP ${res.status} — un enlace roto resta credibilidad`);
      } catch {
        log.warn(`${k}: no responde. Un enlace muerto es peor que no ponerlo.`);
      }
    }
  }

  // ── Hosting (§4.5) ─────────────────────────────────────────────────────────
  log.title('Hosting de la metadata (§4.5) — ninguna opción cuesta dinero');

  if (imageRaw !== null) {
    log.ok('Detectado remoto de GitHub. URL raw que tendrá el JSON una vez lo subas:');
    log.kv('METADATA_URI', `${deriveGithubRawUrl('assets/metadata.json') ?? ''}`);
    log.dim('      Solo funcionará cuando el repositorio sea PÚBLICO y el fichero esté empujado.');
  } else {
    log.warn('No hay remoto de GitHub configurado, así que no puedo derivar una URL.');
  }

  log.plain('');
  log.info('Opción A — GitHub raw:');
  log.dim('      1. Crea un repo público y empuja al menos assets/');
  log.dim('      2. Copia la URL raw de assets/metadata.json');
  log.dim('      3. Ponla en .env como METADATA_URI=...');
  log.plain('');
  log.info('Opción B — IPFS (Pinata / web3.storage, tier gratuito):');
  log.dim('      1. Sube primero logo.png, copia su CID');
  log.dim('      2. Pon esa URL en IMAGE_URI y vuelve a ejecutar este script');
  log.dim('      3. Sube el metadata.json resultante y pon su URL en METADATA_URI');
  log.plain('');
  log.warn('No subo nada a ningún sitio: publicar contenido es una acción hacia fuera y la decides tú.');

  log.plain('');
  log.info('Cuando tengas METADATA_URI en .env:  npm run metadata:attach');
}

main().catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
