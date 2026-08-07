/**
 * Verificación BYTE A BYTE de las instrucciones que se enviarán a la cadena.
 *
 * ── POR QUÉ ESTE FICHERO ────────────────────────────────────────────────────
 * "El token no puede congelar cuentas" es la afirmación más importante del §2.1,
 * y hasta ahora solo estaba respaldada por un comentario. Aquí se comprueba en
 * el byte concreto de la instrucción `InitializeMint2` que la freezeAuthority
 * va como `None`. Si alguien cambiara esa decisión sin querer, este test falla.
 *
 * Todo es offline: no toca la red, no necesita fondos, no cuesta nada.
 * Prueba el MISMO código que ejecuta `scripts/token-create.ts`.
 */

import { describe, it, expect } from 'vitest';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, MINT_SIZE } from '@solana/spl-token';

import { buildCreateMintInstructions, buildMintSupplyInstructions } from '../src/lib/token-build.js';
import { tokenConfig, totalSupplyBaseUnits } from '../config/token.config.js';

/** Discriminadores del SPL Token Program (formato de instrucción, no tarifas). */
const IX_INITIALIZE_MINT_2 = 20;
const IX_MINT_TO = 7;

const payer = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;
const profile = tokenConfig.devnet;

describe('crear e inicializar el mint', () => {
  const { instructions, freezeAuthority } = buildCreateMintInstructions({
    payer,
    mint,
    decimals: tokenConfig.decimals,
    rentLamports: 1_461_600,
    profile,
  });

  it('son exactamente dos instrucciones: createAccount + initializeMint2', () => {
    expect(instructions).toHaveLength(2);
    expect(instructions[0]?.programId.equals(SystemProgram.programId)).toBe(true);
    expect(instructions[1]?.programId.equals(TOKEN_PROGRAM_ID)).toBe(true);
  });

  it('reserva exactamente el tamaño de un mint', () => {
    // createAccount: u32 discriminador (0) + u64 lamports + u64 space + 32 owner
    const data = instructions[0]!.data;
    const space = data.readBigUInt64LE(4 + 8);
    expect(Number(space)).toBe(MINT_SIZE);
  });

  it('§2.1 — el token NACE SIN freezeAuthority (comprobado en el byte)', () => {
    expect(freezeAuthority).toBeNull();

    const data = instructions[1]!.data;
    expect(data.readUInt8(0)).toBe(IX_INITIALIZE_MINT_2);
    expect(data.readUInt8(1)).toBe(tokenConfig.decimals);

    // layout: u8 ix · u8 decimals · [32] mintAuthority · u8 opción freeze · [32] freeze
    const mintAuthority = new PublicKey(data.subarray(2, 34));
    expect(mintAuthority.equals(payer)).toBe(true);

    const freezeOption = data.readUInt8(34);
    expect(freezeOption).toBe(0); // 0 = None. Si fuera 1, el token podría congelar cuentas.
  });

  it('usa el SPL Token Program oficial, no otro programa', () => {
    expect(instructions[1]?.programId.toBase58()).toBe('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  });
});

describe('acuñación del supply', () => {
  const { instructions, targets } = buildMintSupplyInstructions(payer, mint, profile);

  it('genera una ATA y un mintTo por asignación', () => {
    expect(targets).toHaveLength(profile.allocations.length);
    expect(instructions).toHaveLength(profile.allocations.length * 2);
  });

  it('usa el Associated Token Program oficial', () => {
    expect(instructions[0]?.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
  });

  it('acuña exactamente la cantidad configurada, ni un token más', () => {
    const mintToIx = instructions[1]!;
    expect(mintToIx.programId.equals(TOKEN_PROGRAM_ID)).toBe(true);

    const data = mintToIx.data;
    expect(data.readUInt8(0)).toBe(IX_MINT_TO);

    const amount = data.readBigUInt64LE(1);
    expect(amount).toBe(targets[0]!.baseUnits);
  });

  it('la suma de todo lo acuñado es exactamente el supply total', () => {
    const total = targets.reduce((a, t) => a + t.baseUnits, 0n);
    expect(total).toBe(totalSupplyBaseUnits());
  });

  it('§2.1 — cada asignación va a una wallet distinta', () => {
    const owners = targets.map((t) => t.owner.toBase58());
    expect(new Set(owners).size).toBe(owners.length);
  });

  it('la autoridad que acuña es el pagador, no un tercero oculto', () => {
    const mintToIx = instructions[1]!;
    const authority = mintToIx.keys[2];
    expect(authority?.pubkey.equals(payer)).toBe(true);
    expect(authority?.isSigner).toBe(true);
  });
});

describe('el perfil de mainnet no puede construir instrucciones a escondidas', () => {
  it('no tiene asignaciones, así que no acuña nada', () => {
    const { instructions, targets } = buildMintSupplyInstructions(payer, mint, tokenConfig.mainnet);
    expect(targets).toHaveLength(0);
    expect(instructions).toHaveLength(0);
  });
});
