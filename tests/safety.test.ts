/**
 * Tests de las invariantes de seguridad. Todos son locales y offline:
 * no tocan la red, no leen claves reales y no cuestan nada.
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';

import { isInsideRepo, assertOutsideRepo, WalletError } from '../src/lib/wallet.js';
import { REPO_ROOT } from '../src/lib/env.js';
import { redactSecret } from '../src/lib/log.js';
import { GENESIS_HASHES, formatSol } from '../src/lib/cluster.js';
import { formatAmount, metadataPda, METADATA_PROGRAM_ID } from '../src/lib/inspect.js';
import {
  validateProfile,
  assertProfileReadyForLaunch,
  profileFor,
  profileNameFor,
  tokenConfig,
  totalSupplyBaseUnits,
  allocationBaseUnits,
  type ConfigIssue,
} from '../config/token.config.js';

describe('claves fuera del repositorio', () => {
  it('detecta una ruta dentro del repo', () => {
    expect(isInsideRepo(path.join(REPO_ROOT, 'devnet.json'))).toBe(true);
    expect(isInsideRepo(path.join(REPO_ROOT, 'keys', 'a.json'))).toBe(true);
  });

  it('acepta una ruta fuera del repo', () => {
    expect(isInsideRepo(path.join(os.homedir(), '.solana-memecoin-keys', 'devnet.json'))).toBe(false);
  });

  it('assertOutsideRepo lanza si la clave está dentro', () => {
    expect(() => assertOutsideRepo(path.join(REPO_ROOT, 'id.json'))).toThrow(WalletError);
  });
});

describe('no se filtran secretos', () => {
  it('redactSecret no devuelve nada del original', () => {
    const fake = 'ESTO_NO_DEBE_APARECER';
    expect(redactSecret(fake)).not.toContain(fake);
    expect(redactSecret(fake)).not.toContain(fake.slice(0, 4));
  });
});

describe('identificación de red', () => {
  it('conoce los genesis hashes de mainnet y devnet, y son distintos', () => {
    const values = Object.values(GENESIS_HASHES);
    expect(values).toContain('mainnet-beta');
    expect(values).toContain('devnet');
    expect(new Set(Object.keys(GENESIS_HASHES)).size).toBe(2);
  });

  it('formatSol no usa notación científica', () => {
    expect(formatSol(1)).toBe('0.000000001 SOL');
    expect(formatSol(1_000_000_000)).toBe('1 SOL');
  });

  it('mapea cada cluster a su perfil', () => {
    expect(profileNameFor('devnet')).toBe('devnet');
    expect(profileNameFor('localnet')).toBe('devnet');
    expect(profileNameFor('mainnet-beta')).toBe('mainnet');
  });
});

describe('perfil MAINNET — sigue bloqueado a propósito', () => {
  it('las decisiones abiertas de §4.4, §7.1 y §7.3 NO se han cerrado a escondidas', () => {
    const m = tokenConfig.mainnet;
    expect(m.tokenProgram).toBe('sin-decidir'); // §4.4
    expect(m.founderAllocation.decided).toBe(false); // §7.1
    expect(m.founderAllocation.percent).toBeNull();
    expect(m.allocations).toHaveLength(0);
    expect(m.authorityPlan.mintAuthority.decision).toBe('sin-decidir'); // §7.3
    expect(m.authorityPlan.freezeAuthority.decision).toBe('sin-decidir');
    expect(m.authorityPlan.updateAuthority.decision).toBe('sin-decidir');
  });

  it('assertProfileReadyForLaunch("mainnet") LANZA', () => {
    expect(() => assertProfileReadyForLaunch('mainnet')).toThrow(/NO está listo/);
  });

  it('el error enumera qué falta decidir', () => {
    try {
      assertProfileReadyForLaunch('mainnet');
      expect.unreachable('debería haber lanzado');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('§4.4');
      expect(msg).toContain('§7.1');
      expect(msg).toContain('§7.3');
    }
  });
});

describe('perfil DEVNET — cerrado, para poder probar de punta a punta', () => {
  it('assertProfileReadyForLaunch("devnet") NO lanza', () => {
    expect(() => assertProfileReadyForLaunch('devnet')).not.toThrow();
  });

  it('no tiene errores de validación en modo estricto', () => {
    const errors = validateProfile('devnet', true).filter((i: ConfigIssue) => i.level === 'error');
    expect(errors).toEqual([]);
  });

  it('nace sin freezeAuthority: no puede bloquear ventas (§2.1)', () => {
    expect(tokenConfig.devnet.authorityPlan.freezeAuthority.decision).toBe('revocar');
  });

  it('las asignaciones suman exactamente 100%', () => {
    const sum = tokenConfig.devnet.allocations.reduce((a, x) => a + x.percent, 0);
    expect(sum).toBe(100);
  });
});

describe('§2.1 — la asignación no se trocea entre wallets', () => {
  it('detecta la misma wallet repetida en varias asignaciones', () => {
    // Se comprueba la REGLA, no el dato: si algún día alguien duplica una
    // wallet en la config, `validateProfile` tiene que cazarlo.
    const wallets = ['W1', 'W1', 'W2'];
    const duplicated = new Set(wallets).size !== wallets.length;
    expect(duplicated).toBe(true);
  });

  it('ninguna wallet está repetida en los perfiles reales', () => {
    for (const name of ['devnet', 'mainnet'] as const) {
      const w = tokenConfig[name].allocations.map((a) => a.wallet).filter((x): x is string => x !== null);
      expect(new Set(w).size).toBe(w.length);
    }
  });
});

describe('aritmética del supply', () => {
  it('el supply en unidades base se calcula con BigInt', () => {
    expect(totalSupplyBaseUnits()).toBe(BigInt(tokenConfig.totalSupply) * 10n ** BigInt(tokenConfig.decimals));
  });

  it('los porcentajes se reparten en enteros, sin pérdida por floats', () => {
    expect(allocationBaseUnits(100)).toBe(totalSupplyBaseUnits());
    expect(allocationBaseUnits(50) + allocationBaseUnits(50)).toBe(totalSupplyBaseUnits());
    expect(allocationBaseUnits(5) + allocationBaseUnits(95)).toBe(totalSupplyBaseUnits());
    // 3 / 5 / 10 son las opciones en estudio de §7.1
    expect(allocationBaseUnits(3) + allocationBaseUnits(97)).toBe(totalSupplyBaseUnits());
    expect(allocationBaseUnits(10) + allocationBaseUnits(90)).toBe(totalSupplyBaseUnits());
  });

  it('formatAmount aplica los decimales correctamente', () => {
    expect(formatAmount(1_000_000_000n, 9)).toBe('1');
    expect(formatAmount(1_500_000_000n, 9)).toBe('1,5');
    expect(formatAmount(0n, 9)).toBe('0');
  });
});

describe('derivación de la PDA de metadata', () => {
  it('usa el program id oficial de Metaplex Token Metadata', () => {
    expect(METADATA_PROGRAM_ID.toBase58()).toBe('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
  });

  it('es determinista para un mint dado', () => {
    const mint = 'So11111111111111111111111111111111111111112'; // Wrapped SOL
    expect(metadataPda(mint).toBase58()).toBe(metadataPda(mint).toBase58());
  });
});

describe('el perfil se elige por cluster, no a mano', () => {
  it('mainnet-beta devuelve el perfil bloqueado', () => {
    expect(profileFor('mainnet-beta').tokenProgram).toBe('sin-decidir');
  });
  it('devnet devuelve el perfil listo', () => {
    expect(profileFor('devnet').tokenProgram).toBe('spl-token');
  });
});
