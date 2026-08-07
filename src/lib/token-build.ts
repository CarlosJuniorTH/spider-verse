/**
 * token-build.ts — construcción de las instrucciones del token.
 *
 * Está separado de `scripts/token-create.ts` a propósito: así los tests pueden
 * verificar **byte a byte** las instrucciones que se van a enviar de verdad, sin
 * red, sin fondos y sin gastar nada. No es una copia del código real: ES el
 * código real.
 *
 * Lo que se comprueba en `tests/instructions.test.ts`:
 *  · que el token nace SIN freezeAuthority (§2.1, no honeypot) — verificado en
 *    el byte de opción de la instrucción, no en un comentario
 *  · que la cantidad acuñada es exactamente la configurada
 *  · que se usan los programas oficiales y no otros
 */

import { Keypair, PublicKey, SystemProgram, type TransactionInstruction } from '@solana/web3.js';
import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createInitializeMint2Instruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { allocationBaseUnits, type TokenProfile } from '../../config/token.config.js';

export function tokenProgramIdFor(profile: TokenProfile): PublicKey {
  return profile.tokenProgram === 'token-2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
}

export interface CreateMintParams {
  payer: PublicKey;
  mint: PublicKey;
  decimals: number;
  /** Rent exento del mint, consultado al RPC por quien llama. */
  rentLamports: number;
  profile: TokenProfile;
}

/**
 * Instrucciones para crear e inicializar el mint.
 *
 * `freezeAuthority` solo puede fijarse aquí: no se puede añadir después. Si el
 * perfil dice `revocar`, se pasa `null` y el token queda incapaz de congelar
 * cuentas para siempre. Es lo contrario de un honeypot (§2.1).
 */
export function buildCreateMintInstructions(p: CreateMintParams): {
  instructions: TransactionInstruction[];
  freezeAuthority: PublicKey | null;
} {
  const programId = tokenProgramIdFor(p.profile);
  const revokeFreeze = p.profile.authorityPlan.freezeAuthority.decision === 'revocar';
  const freezeAuthority = revokeFreeze ? null : p.payer;

  return {
    freezeAuthority,
    instructions: [
      SystemProgram.createAccount({
        fromPubkey: p.payer,
        newAccountPubkey: p.mint,
        space: MINT_SIZE,
        lamports: p.rentLamports,
        programId,
      }),
      createInitializeMint2Instruction(p.mint, p.decimals, p.payer, freezeAuthority, programId),
    ],
  };
}

export interface AllocationTarget {
  label: string;
  percent: number;
  owner: PublicKey;
  ata: PublicKey;
  baseUnits: bigint;
  purpose: string;
}

/**
 * Instrucciones para crear las cuentas de destino y acuñar el supply.
 * Una ATA + un mintTo por asignación, en el orden del perfil.
 */
export function buildMintSupplyInstructions(
  payer: PublicKey,
  mint: PublicKey,
  profile: TokenProfile,
): { instructions: TransactionInstruction[]; targets: AllocationTarget[] } {
  const programId = tokenProgramIdFor(profile);
  const instructions: TransactionInstruction[] = [];
  const targets: AllocationTarget[] = [];

  for (const alloc of profile.allocations) {
    const owner = alloc.wallet === null ? payer : new PublicKey(alloc.wallet);
    const ata = getAssociatedTokenAddressSync(mint, owner, false, programId);
    const baseUnits = allocationBaseUnits(alloc.percent);

    instructions.push(
      createAssociatedTokenAccountInstruction(payer, ata, owner, mint, programId),
      createMintToInstruction(mint, ata, payer, baseUnits, [], programId),
    );

    targets.push({ label: alloc.label, percent: alloc.percent, owner, ata, baseUnits, purpose: alloc.purpose });
  }

  return { instructions, targets };
}

/** Genera el keypair del mint. Se expone para que los tests sean deterministas. */
export function generateMintKeypair(): Keypair {
  return Keypair.generate();
}
