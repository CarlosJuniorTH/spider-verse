/**
 * wallet.ts — carga y creación SEGURA de keypairs.
 *
 * Invariantes (CONTEXTO.md §2.2):
 *  1. Este módulo NUNCA imprime, devuelve como string, ni serializa a log
 *     material de clave privada. Solo pubkeys.
 *  2. Se niega a leer o escribir una clave que esté DENTRO del repositorio.
 *  3. No se generan ni se manejan seed phrases en ningún punto del proyecto.
 *     Un keypair de Solana es un par ed25519; no necesitamos mnemónico para nada.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Keypair, PublicKey } from '@solana/web3.js';
import { REPO_ROOT, KEYS_DIR, env } from './env.js';

export class WalletError extends Error {}

/** ¿La ruta está dentro del repositorio? (defensa contra commitear claves) */
export function isInsideRepo(target: string): boolean {
  const rel = path.relative(REPO_ROOT, path.resolve(target));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function assertOutsideRepo(target: string): void {
  if (isInsideRepo(target)) {
    throw new WalletError(
      `La ruta de clave está DENTRO del repositorio:\n  ${target}\n` +
        `Las claves deben vivir fuera, por ejemplo en:\n  ${KEYS_DIR}\n` +
        'Corrige KEYPAIR_PATH en .env. (CONTEXTO.md §2.2)',
    );
  }
}

/**
 * Lee un fichero de keypair en formato estándar de Solana:
 * un JSON con un array de 64 enteros (0-255).
 */
export function loadKeypair(keypairPath: string = env.KEYPAIR_PATH): Keypair {
  assertOutsideRepo(keypairPath);

  if (!fs.existsSync(keypairPath)) {
    throw new WalletError(
      `No existe el fichero de clave:\n  ${keypairPath}\n` + 'Genera uno con:  npm run wallet:new',
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
  } catch {
    throw new WalletError(
      `El fichero de clave no es JSON válido:\n  ${keypairPath}\n` +
        'Debe ser un array de 64 números. (No se muestra el contenido por seguridad.)',
    );
  }

  if (!Array.isArray(raw) || raw.length !== 64 || !raw.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    throw new WalletError(
      `El fichero de clave no tiene el formato esperado (array de 64 bytes):\n  ${keypairPath}\n` +
        'No se muestra el contenido por seguridad.',
    );
  }

  try {
    return Keypair.fromSecretKey(Uint8Array.from(raw as number[]));
  } catch {
    throw new WalletError(`Los bytes del fichero no forman un keypair ed25519 válido:\n  ${keypairPath}`);
  }
}

/** Devuelve solo la pubkey, sin materializar el keypair para nadie más. */
export function loadPublicKey(keypairPath: string = env.KEYPAIR_PATH): PublicKey {
  return loadKeypair(keypairPath).publicKey;
}

export interface CreatedWallet {
  publicKey: PublicKey;
  keypairPath: string;
}

/**
 * Genera un keypair nuevo y lo escribe FUERA del repo.
 * Se niega a sobrescribir un fichero existente: perder una clave es irreversible.
 */
export function createKeypairFile(keypairPath: string = env.KEYPAIR_PATH): CreatedWallet {
  assertOutsideRepo(keypairPath);

  if (fs.existsSync(keypairPath)) {
    throw new WalletError(
      `Ya existe un fichero de clave en:\n  ${keypairPath}\n` +
        'NO se sobrescribe: sobrescribir una clave es IRREVERSIBLE y perderías el acceso\n' +
        'a los fondos y a las autoridades del token.\n' +
        'Si de verdad quieres otra, usa otra ruta:  KEYPAIR_PATH=... npm run wallet:new',
    );
  }

  const dir = path.dirname(keypairPath);
  fs.mkdirSync(dir, { recursive: true });

  const keypair = Keypair.generate();
  // Escritura con `wx`: falla si el fichero apareciera entre el check y aquí.
  fs.writeFileSync(keypairPath, JSON.stringify(Array.from(keypair.secretKey)), {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });

  try {
    fs.chmodSync(keypairPath, 0o600);
  } catch {
    /* En Windows chmod es casi simbólico; se avisa en el script. */
  }

  return { publicKey: keypair.publicKey, keypairPath };
}

/** Directorio de claves por defecto, expuesto para los scripts. */
export { KEYS_DIR };
