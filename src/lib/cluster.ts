/**
 * cluster.ts — resolución de red y conexión RPC.
 *
 * Punto clave de seguridad: comprobamos el **genesis hash** que devuelve el RPC
 * y lo comparamos con el de la red que creemos estar usando. Así es imposible
 * que un `RPC_URL` mal puesto nos haga operar en mainnet creyendo que estamos
 * en devnet. (CONTEXTO.md §2.3 y §4.3.)
 */

import { Connection, clusterApiUrl, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { env, type ClusterName } from './env.js';

export { LAMPORTS_PER_SOL };

/**
 * Genesis hashes públicos de las redes de Solana. Son identificadores fijos de
 * cadena (no son tarifas ni parámetros económicos): identifican la red igual que
 * un chain-id. Se usan solo para DETECTAR que el RPC apunta donde decimos.
 * Si algún día no coincidiera ninguno, el código avisa en vez de asumir.
 */
export const GENESIS_HASHES: Readonly<Record<string, ClusterName>> = Object.freeze({
  '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d': 'mainnet-beta',
  EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG: 'devnet',
});

export const DEFAULT_ENDPOINTS: Readonly<Record<ClusterName, string>> = Object.freeze({
  devnet: clusterApiUrl('devnet'),
  'mainnet-beta': clusterApiUrl('mainnet-beta'),
  localnet: 'http://127.0.0.1:8899',
});

export interface ResolvedCluster {
  name: ClusterName;
  endpoint: string;
  /** true solo para `mainnet-beta`. Todo lo que gasta dinero real depende de esto. */
  isMainnet: boolean;
  /** El endpoint viene de `.env` en vez del público por defecto. */
  endpointFromEnv: boolean;
}

export function resolveCluster(): ResolvedCluster {
  const name = env.CLUSTER;
  const endpointFromEnv = env.RPC_URL !== undefined;
  const endpoint = env.RPC_URL ?? DEFAULT_ENDPOINTS[name];
  return { name, endpoint, isMainnet: name === 'mainnet-beta', endpointFromEnv };
}

export function getConnection(cluster: ResolvedCluster = resolveCluster()): Connection {
  return new Connection(cluster.endpoint, 'confirmed');
}

export interface GenesisCheck {
  ok: boolean;
  /** Red que dice el RPC, si la reconocemos. */
  reportedCluster: ClusterName | 'desconocida';
  genesisHash: string;
  message: string;
}

/**
 * Comprueba que el RPC configurado sirve la red que creemos.
 * Devuelve el resultado; NO aborta (quien llama decide qué hacer).
 */
export async function checkGenesisMatchesCluster(
  connection: Connection,
  cluster: ResolvedCluster,
): Promise<GenesisCheck> {
  const genesisHash = await connection.getGenesisHash();
  const reported = GENESIS_HASHES[genesisHash];

  if (cluster.name === 'localnet') {
    return {
      ok: true,
      reportedCluster: reported ?? 'desconocida',
      genesisHash,
      message: 'localnet: cada validator local tiene su propio genesis hash, no se compara.',
    };
  }

  if (reported === undefined) {
    return {
      ok: false,
      reportedCluster: 'desconocida',
      genesisHash,
      message:
        `El RPC devuelve un genesis hash desconocido (${genesisHash}). ` +
        'No se puede confirmar en qué red estás. Revisa RPC_URL.',
    };
  }

  if (reported !== cluster.name) {
    return {
      ok: false,
      reportedCluster: reported,
      genesisHash,
      message:
        `PELIGRO: CLUSTER=${cluster.name} pero el RPC ${cluster.endpoint} sirve ${reported}. ` +
        (reported === 'mainnet-beta'
          ? 'Estarías operando con DINERO REAL creyendo que no. Corrige RPC_URL antes de seguir.'
          : 'Corrige RPC_URL o CLUSTER.'),
    };
  }

  return {
    ok: true,
    reportedCluster: reported,
    genesisHash,
    message: `RPC confirmado como ${reported}.`,
  };
}

/** Formatea lamports como SOL legible (sin notación científica). */
export function formatSol(lamports: number | bigint): string {
  const n = typeof lamports === 'bigint' ? Number(lamports) : lamports;
  const sol = n / LAMPORTS_PER_SOL;
  return `${sol.toFixed(9).replace(/0+$/, '').replace(/\.$/, '')} SOL`;
}

/** URL del explorador para una dirección o firma. */
export function explorerUrl(kind: 'address' | 'tx', value: string, cluster: ResolvedCluster): string {
  const suffix =
    cluster.name === 'mainnet-beta'
      ? ''
      : cluster.name === 'devnet'
        ? '?cluster=devnet'
        : `?cluster=custom&customUrl=${encodeURIComponent(cluster.endpoint)}`;
  return `https://explorer.solana.com/${kind}/${value}${suffix}`;
}
