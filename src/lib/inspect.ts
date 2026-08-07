/**
 * inspect.ts — lectura del estado real del token desde la cadena.
 *
 * Todo aquí es SOLO LECTURA y gratis. Es la base de la FASE 4 y de la
 * transparencia (§1): cualquiera puede correr estos scripts contra cualquier
 * mint, el nuestro o el de otro, y contrastar lo que decimos con lo que hay.
 *
 * No se fía del artefacto local: pregunta a la cadena.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { getMint, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, type Mint } from '@solana/spl-token';

export const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

export interface MintState {
  address: string;
  programId: string;
  programName: 'spl-token' | 'token-2022';
  decimals: number;
  /** Supply en unidades base. */
  supply: bigint;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  isInitialized: boolean;
}

/** Lee el mint probando los dos programas de token (§4.4: soportamos ambos). */
export async function readMint(connection: Connection, address: string): Promise<MintState> {
  const pubkey = new PublicKey(address);
  const info = await connection.getAccountInfo(pubkey, 'confirmed');
  if (info === null) {
    throw new Error(`No existe ninguna cuenta en ${address} (¿red equivocada?).`);
  }

  let programId: PublicKey;
  let programName: 'spl-token' | 'token-2022';
  if (info.owner.equals(TOKEN_PROGRAM_ID)) {
    programId = TOKEN_PROGRAM_ID;
    programName = 'spl-token';
  } else if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    programId = TOKEN_2022_PROGRAM_ID;
    programName = 'token-2022';
  } else {
    throw new Error(`La cuenta ${address} no es un mint: pertenece al programa ${info.owner.toBase58()}.`);
  }

  const mint: Mint = await getMint(connection, pubkey, 'confirmed', programId);

  return {
    address,
    programId: programId.toBase58(),
    programName,
    decimals: mint.decimals,
    supply: mint.supply,
    mintAuthority: mint.mintAuthority?.toBase58() ?? null,
    freezeAuthority: mint.freezeAuthority?.toBase58() ?? null,
    isInitialized: mint.isInitialized,
  };
}

/** PDA de la cuenta de metadata de Metaplex para un mint. */
export function metadataPda(mint: string): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), new PublicKey(mint).toBuffer()],
    METADATA_PROGRAM_ID,
  );
  return pda;
}

export interface OnChainMetadata {
  exists: boolean;
  accountSize: number | null;
  updateAuthority: string | null;
  name: string | null;
  symbol: string | null;
  uri: string | null;
  sellerFeeBasisPoints: number | null;
  isMutable: boolean | null;
  primarySaleHappened: boolean | null;
}

/**
 * Decodifica la cuenta de metadata a mano.
 *
 * POR QUÉ a mano y no con el SDK: para leer no hace falta arrastrar umi, y así
 * el verificador es independiente de la librería con la que se escribió. Si el
 * SDK tuviera un fallo, el verificador no lo heredaría.
 *
 * Formato (Metaplex Token Metadata v1, campos iniciales, todos borsh):
 *   u8   key
 *   [32] updateAuthority
 *   [32] mint
 *   str  name    (u32 len + bytes, con relleno de ceros)
 *   str  symbol
 *   str  uri
 *   u16  sellerFeeBasisPoints
 */
export async function readMetadata(connection: Connection, mint: string): Promise<OnChainMetadata> {
  const pda = metadataPda(mint);
  const info = await connection.getAccountInfo(pda, 'confirmed');

  const empty: OnChainMetadata = {
    exists: false,
    accountSize: null,
    updateAuthority: null,
    name: null,
    symbol: null,
    uri: null,
    sellerFeeBasisPoints: null,
    isMutable: null,
    primarySaleHappened: null,
  };
  if (info === null) return empty;

  const data = info.data;
  let offset = 0;

  const key = data.readUInt8(offset);
  offset += 1;
  const updateAuthority = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
  offset += 32;
  offset += 32; // mint, ya lo conocemos

  /** Lee un string borsh y le quita el relleno de ceros que usa Metaplex. */
  const readStr = (): string => {
    const len = data.readUInt32LE(offset);
    offset += 4;
    const raw = data.subarray(offset, offset + len).toString('utf8');
    offset += len;
    return raw.replace(/\0+$/, '').trim();
  };

  const name = readStr();
  const symbol = readStr();
  const uri = readStr();
  const sellerFeeBasisPoints = data.readUInt16LE(offset);
  offset += 2;

  // creators: Option<Vec<Creator>>
  const hasCreators = data.readUInt8(offset) === 1;
  offset += 1;
  if (hasCreators) {
    const n = data.readUInt32LE(offset);
    offset += 4;
    offset += n * 34; // 32 pubkey + 1 verified + 1 share
  }

  const primarySaleHappened = data.readUInt8(offset) === 1;
  offset += 1;
  const isMutable = data.readUInt8(offset) === 1;

  return {
    exists: true,
    accountSize: data.length,
    updateAuthority,
    name,
    symbol,
    uri,
    sellerFeeBasisPoints,
    isMutable,
    primarySaleHappened,
  };
}

export interface HolderInfo {
  /** Dirección de la token account (no del propietario). */
  tokenAccount: string;
  /** Propietario real, si se ha podido resolver. */
  owner: string | null;
  amount: bigint;
  percent: number;
}

/**
 * Mayores tenedores. `getTokenLargestAccounts` devuelve como máximo 20;
 * es suficiente para medir concentración, que es lo que miran RugCheck,
 * Bubblemaps y la pestaña de holders de DexScreener (§7.1).
 */
export async function readTopHolders(connection: Connection, mint: string, supply: bigint): Promise<HolderInfo[]> {
  const largest = await connection.getTokenLargestAccounts(new PublicKey(mint), 'confirmed');
  const addresses = largest.value.map((a) => a.address);

  // Los propietarios se resuelven en UNA sola llamada por lotes. Pedirlos de uno
  // en uno son ~21 peticiones y los RPC públicos responden 429.
  const owners = new Map<string, string>();
  if (addresses.length > 0) {
    try {
      const parsed = await connection.getMultipleParsedAccounts(addresses, { commitment: 'confirmed' });
      parsed.value.forEach((acc, i) => {
        const addr = addresses[i];
        if (acc === null || addr === undefined) return;
        if (typeof acc.data === 'object' && 'parsed' in acc.data) {
          const owner = (acc.data.parsed as { info?: { owner?: string } }).info?.owner;
          if (owner !== undefined) owners.set(addr.toBase58(), owner);
        }
      });
    } catch {
      // Sin propietarios resueltos seguimos: se muestran las token accounts.
    }
  }

  return largest.value.map((acc) => {
    const amount = BigInt(acc.amount);
    return {
      tokenAccount: acc.address.toBase58(),
      owner: owners.get(acc.address.toBase58()) ?? null,
      amount,
      percent: supply === 0n ? 0 : Number((amount * 10_000n) / supply) / 100,
    };
  });
}

/**
 * Formatea unidades base como cantidad legible.
 *
 * Coherente con la convención española: `.` separa miles y `,` separa decimales.
 * Mezclarlas es peligroso con cifras de token — "1.5" se leería como mil
 * quinientos en vez de uno coma cinco.
 */
export function formatAmount(baseUnits: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = baseUnits / divisor;
  const frac = baseUnits % divisor;
  const fracStr = frac === 0n ? '' : `,${frac.toString().padStart(decimals, '0').replace(/0+$/, '')}`;
  return `${whole.toLocaleString('es-ES')}${fracStr}`;
}
