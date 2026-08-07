/**
 * artifacts.ts — registro de lo que se ha desplegado.
 *
 * POR QUÉ EXISTE: la transparencia (§1) necesita un rastro. Cada creación de
 * token deja un JSON con mint, firmas, autoridades y distribución, de forma que
 * cualquiera pueda contrastarlo contra la cadena.
 *
 * NO contiene secretos: solo direcciones públicas y firmas, que ya son públicas
 * en la blockchain. Los de devnet están en `.gitignore` porque se regeneran;
 * los de mainnet se versionan a mano y a propósito.
 */

import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './env.js';
import type { ClusterName } from './env.js';
import { positionals, KNOWN_FLAGS } from './args.js';

export interface AllocationRecord {
  label: string;
  percent: number;
  wallet: string;
  baseUnits: string;
  purpose: string;
}

export interface DeploymentArtifact {
  /** Momento del despliegue, ISO-8601. */
  createdAt: string;
  cluster: ClusterName;
  /** Dirección del mint. Es el identificador público del token. */
  mint: string;
  /** Wallet que pagó y firmó. Pública por diseño (§2.1). */
  deployer: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  tokenProgram: string;
  allocations: AllocationRecord[];
  authorities: {
    mint: string | null;
    freeze: string | null;
    update: string | null;
  };
  metadata: {
    uri: string | null;
    metadataPda: string | null;
  };
  signatures: Record<string, string>;
  /** Coste real pagado, en lamports. */
  costLamports: number;
  notes: string[];
}

function artifactDir(cluster: ClusterName): string {
  return path.join(REPO_ROOT, 'artifacts', cluster);
}

/** Ruta del artefacto "último despliegue" de un cluster. */
export function latestArtifactPath(cluster: ClusterName): string {
  return path.join(artifactDir(cluster), 'latest.json');
}

export function saveArtifact(artifact: DeploymentArtifact): { latest: string; historical: string } {
  const dir = artifactDir(artifact.cluster);
  fs.mkdirSync(dir, { recursive: true });

  const json = `${JSON.stringify(artifact, null, 2)}\n`;
  const latest = latestArtifactPath(artifact.cluster);
  const historical = path.join(dir, `${artifact.mint}.json`);

  fs.writeFileSync(historical, json, 'utf8');
  fs.writeFileSync(latest, json, 'utf8');

  return { latest, historical };
}

export function loadLatestArtifact(cluster: ClusterName): DeploymentArtifact | null {
  const p = latestArtifactPath(cluster);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8')) as DeploymentArtifact;
}

/**
 * ¿Este mint es uno de los nuestros?
 *
 * Importa porque los verificadores se pueden ejecutar contra CUALQUIER token
 * (el de otro proyecto, para compararlo). Contra un token ajeno no tiene sentido
 * comparar con nuestra configuración: solo hay que informar de lo que hay.
 */
export function isOurMint(cluster: ClusterName, mint: string): boolean {
  return loadLatestArtifact(cluster)?.mint === mint;
}

/**
 * Resuelve qué mint inspeccionar: el argumento de línea de comandos, o el del
 * último despliegue registrado. Los scripts de verificación lo usan para poder
 * llamarse sin argumentos tras crear el token.
 */
export function resolveMintArg(cluster: ClusterName, explicitArgs?: string[]): string {
  const explicit = (explicitArgs ?? positionals(KNOWN_FLAGS))[0];
  if (explicit !== undefined) return explicit;

  const artifact = loadLatestArtifact(cluster);
  if (artifact !== null) return artifact.mint;

  throw new Error(
    `No se ha indicado ningún mint y no hay despliegue registrado en ${latestArtifactPath(cluster)}.\n` +
      'Pasa la dirección como argumento:  npm run verify:supply -- <MINT>\n' +
      'O crea el token primero:  npm run token:create',
  );
}
