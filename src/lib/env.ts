/**
 * env.ts — carga y VALIDA el fichero `.env`.
 *
 * CONTEXTO.md §2.2: el `.env` solo contiene la RUTA a la clave, jamás la clave.
 * Este módulo lo hace cumplir: si detecta algo que parece material de clave
 * dentro del `.env`, aborta el proceso.
 */

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

/** Raíz del repositorio (este fichero vive en `<raíz>/src/lib/env.ts`). */
export const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

/** Directorio (fuera del repo) donde viven las claves. */
export const KEYS_DIR = path.join(os.homedir(), '.solana-memecoin-keys');

const ENV_PATH = path.join(REPO_ROOT, '.env');

// ── Antifuga: inspeccionar el .env crudo antes de cargarlo ───────────────────

/**
 * Claves de entorno cuyo NOMBRE sugiere que alguien ha pegado un secreto.
 * Se detecta el nombre, nunca se imprime el valor.
 */
const FORBIDDEN_KEY_NAMES = [
  'PRIVATE_KEY',
  'SECRET_KEY',
  'SECRETKEY',
  'MNEMONIC',
  'SEED_PHRASE',
  'SEEDPHRASE',
  'SEED',
  'KEYPAIR_JSON',
  'KEYPAIR_SECRET',
  'WALLET_SECRET',
];

function assertNoSecretsInEnvFile(): void {
  if (!fs.existsSync(ENV_PATH)) return;
  const raw = fs.readFileSync(ENV_PATH, 'utf8');
  const offenders: string[] = [];

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim().toUpperCase();
    const value = trimmed.slice(eq + 1).trim();

    if (FORBIDDEN_KEY_NAMES.includes(key) && value !== '') {
      offenders.push(`la variable ${key} tiene contenido`);
      continue;
    }
    // Un array de 64 bytes pegado tal cual: "[12,34,...]"
    if (/^\[\s*\d+\s*(,\s*\d+\s*){20,}\]$/.test(value)) {
      offenders.push(`la variable ${key} parece un array de bytes de keypair`);
      continue;
    }
    // 12/24 palabras seguidas = posible seed phrase.
    if (/^(?:[a-z]{3,8}\s+){11,}[a-z]{3,8}$/.test(value.replace(/^["']|["']$/g, ''))) {
      offenders.push(`la variable ${key} parece una seed phrase`);
    }
  }

  if (offenders.length > 0) {
    console.error('\n✗ ABORTADO: se ha detectado posible material de clave dentro de .env\n');
    for (const o of offenders) console.error(`  - ${o}`);
    console.error(
      '\n  CONTEXTO.md §2.2: el .env solo puede contener la RUTA a la clave.',
      '\n  Borra ese valor del .env. Si esa clave llegó a existir, considérala comprometida',
      '\n  y genera una nueva con `npm run wallet:new`.\n',
    );
    process.exit(1);
  }
}

assertNoSecretsInEnvFile();
dotenv.config({ path: ENV_PATH, quiet: true });

// ── Esquema ──────────────────────────────────────────────────────────────────

const boolish = z
  .string()
  .optional()
  .transform((v) => v?.trim().toLowerCase())
  .refine((v) => v === undefined || v === '' || ['true', 'false', '1', '0'].includes(v), {
    message: 'debe ser true o false',
  })
  .transform((v) => v === 'true' || v === '1');

const optionalNumber = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : Number(v)))
  .refine((v) => v === undefined || (Number.isFinite(v) && v > 0), {
    message: 'debe ser un número positivo',
  });

export const CLUSTERS = ['devnet', 'mainnet-beta', 'localnet'] as const;
export type ClusterName = (typeof CLUSTERS)[number];

const schema = z.object({
  CLUSTER: z
    .enum(CLUSTERS)
    .optional()
    .transform((v) => v ?? 'devnet'),
  RPC_URL: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()))
    .refine((v) => v === undefined || /^https?:\/\//.test(v), {
      message: 'debe ser una URL http(s)',
    }),
  KEYPAIR_PATH: z
    .string()
    .optional()
    .transform((v) => {
      const raw = v === undefined || v.trim() === '' ? path.join(KEYS_DIR, 'devnet.json') : v.trim();
      return path.resolve(raw);
    }),
  ALLOW_MAINNET: boolish,
  I_UNDERSTAND_THIS_SPENDS_REAL_MONEY: boolish,
  SOL_PRICE_USD: optionalNumber,
  EUR_PER_USD: optionalNumber,
  /** URI pública del JSON de metadata (§4.5). La genera `npm run metadata:build`. */
  METADATA_URI: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()))
    .refine((v) => v === undefined || /^(https?|ipfs|ar):\/\//.test(v), {
      message: 'debe ser una URL http(s), ipfs:// o ar://',
    })
    .refine((v) => v === undefined || v.length <= 200, {
      message: 'Metaplex limita la URI a 200 caracteres',
    }),
});

const parsed = schema.safeParse({
  CLUSTER: process.env['CLUSTER'],
  RPC_URL: process.env['RPC_URL'],
  KEYPAIR_PATH: process.env['KEYPAIR_PATH'],
  ALLOW_MAINNET: process.env['ALLOW_MAINNET'],
  I_UNDERSTAND_THIS_SPENDS_REAL_MONEY: process.env['I_UNDERSTAND_THIS_SPENDS_REAL_MONEY'],
  SOL_PRICE_USD: process.env['SOL_PRICE_USD'],
  EUR_PER_USD: process.env['EUR_PER_USD'],
  METADATA_URI: process.env['METADATA_URI'],
});

if (!parsed.success) {
  console.error('\n✗ Configuración de entorno inválida (.env):\n');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.') || '(raíz)'}: ${issue.message}`);
  }
  console.error('\n  Copia `.env.example` a `.env` y revisa los valores.\n');
  process.exit(1);
}

export const env = Object.freeze(parsed.data);
export type Env = typeof env;

/** ¿Existe un `.env` real, o estamos corriendo solo con valores por defecto? */
export const envFileExists = fs.existsSync(ENV_PATH);
export const envFilePath = ENV_PATH;
