/**
 * token.config.ts — la tokenómica como DATOS, no repartida por el código.
 *
 * ── POR QUÉ HAY DOS PERFILES ────────────────────────────────────────────────
 * `devnet`  : totalmente decidido. Es un token de PRUEBA sin valor. Permite
 *             ejecutar las FASES 3-5 de punta a punta sin bloquear nada.
 * `mainnet` : deliberadamente SIN DECIDIR. Las decisiones de CONTEXTO.md
 *             §4.4 (programa), §7.1 (asignación del fundador) y §7.3
 *             (autoridades) son del operador, no del código. Mientras sigan
 *             abiertas, `assertProfileReadyForLaunch('mainnet')` lanza y
 *             ningún script de mainnet puede ejecutarse.
 *
 * Que devnet funcione NO desbloquea mainnet. Son perfiles independientes.
 */

import { z } from 'zod';

// ── Esquema ──────────────────────────────────────────────────────────────────

const allocationSchema = z.object({
  /** Etiqueta pública, visible y verificable. */
  label: z.string().min(1),
  /** Porcentaje del supply total. */
  percent: z.number().min(0).max(100),
  /**
   * Wallet destino. `null` = la del firmante (deployer).
   * CONTEXTO.md §2.1: UNA sola wallet por asignación. Nada de trocear la parte
   * del fundador entre varias direcciones para disimular concentración.
   */
  wallet: z.string().nullable(),
  /** Explicación pública de para qué es esta parte. */
  purpose: z.string().min(1),
});
export type Allocation = z.infer<typeof allocationSchema>;

const authorityDecisionSchema = z.object({
  decision: z.enum(['mantener', 'revocar', 'sin-decidir']),
  /** Momento en el que se aplicaría. */
  when: z.string(),
  /** Consecuencia irreversible de revocar. Obligatorio escribirla. */
  irreversibleConsequence: z.string().min(1),
});
export type AuthorityDecision = z.infer<typeof authorityDecisionSchema>;

const profileSchema = z.object({
  name: z.string().min(1).max(32),
  symbol: z
    .string()
    .min(2)
    .max(10)
    .regex(/^[A-Z0-9]+$/, 'el símbolo debe ir en mayúsculas sin espacios'),
  description: z.string().min(1),

  /** §4.4 — `sin-decidir` bloquea el lanzamiento de ese perfil. */
  tokenProgram: z.enum(['spl-token', 'token-2022', 'sin-decidir']),

  founderAllocation: z.object({
    decided: z.boolean(),
    optionsUnderReview: z.array(z.number().min(0).max(100)),
    percent: z.number().min(0).max(100).nullable(),
  }),

  /** Reparto completo. Debe sumar 100 cuando el perfil esté cerrado. */
  allocations: z.array(allocationSchema),

  authorityPlan: z.object({
    mintAuthority: authorityDecisionSchema,
    freezeAuthority: authorityDecisionSchema,
    updateAuthority: authorityDecisionSchema,
  }),

  metadata: z.object({
    /** URI del JSON de metadata. null hasta resolver §4.5. */
    uri: z.string().nullable(),
    imageFile: z.string(),
    /** Royalties de creador en basis points. 0 = sin royalties. */
    sellerFeeBasisPoints: z.number().int().min(0).max(10000),
    externalUrl: z.string().nullable(),
    /**
     * Enlaces públicos del proyecto. Van al campo `extensions` del JSON, que es
     * lo que leen wallets y exploradores. Sin esto, el token no apunta a ningún
     * sitio y no hay forma de saber quién está detrás.
     *
     * Poner enlaces MUERTOS es peor que no poner ninguno: es la primera cosa que
     * comprueba quien sospecha. `metadata:build` avisa si alguno no responde.
     */
    socials: z.object({
      website: z.string().nullable(),
      twitter: z.string().nullable(),
      telegram: z.string().nullable(),
      discord: z.string().nullable(),
    }),
  }),
});
export type TokenProfile = z.infer<typeof profileSchema>;

const configSchema = z.object({
  /** Comunes a los dos perfiles: cambiarlos afecta a ambos. */
  decimals: z.number().int().min(0).max(9),
  totalSupply: z.number().int().positive(),
  devnet: profileSchema,
  mainnet: profileSchema,
});

export type ProfileName = 'devnet' | 'mainnet';

// ── Valores ──────────────────────────────────────────────────────────────────

/** Texto reutilizado: revocar autoridades es irreversible (§7.3). */
const IRREVERSIBLE = {
  mint: 'Revocar mintAuthority hace IMPOSIBLE acuñar más tokens para siempre. No hay vuelta atrás.',
  freeze:
    'Revocar freezeAuthority impide congelar cuentas para siempre. Es lo que los analizadores esperan ver ' +
    'revocado; mantenerla se interpreta como riesgo de bloqueo de ventas (§2.1).',
  update:
    'Revocar updateAuthority congela la metadata para siempre: un error de imagen o de URI ya no se puede ' +
    'corregir nunca.',
} as const;

const raw = {
  decimals: 9,
  totalSupply: 1_000_000_000,

  // ── Perfil DEVNET: decidido. Token de prueba, sin valor económico. ─────────
  devnet: {
    name: 'Sasha',
    symbol: 'SASHA',
    description:
      'Sasha. Ensayo en la devnet de Solana para ver cómo queda el token antes de nada. ' +
      'NO tiene ningún valor económico, no es negociable y no existe fuera de la red de pruebas.',

    tokenProgram: 'spl-token', // conservador, el mismo que se propone para mainnet

    founderAllocation: {
      decided: true,
      optionsUnderReview: [],
      percent: 100, // en devnet todo va a la wallet de despliegue; no hay mercado
    },

    allocations: [
      {
        label: 'Tesorería de despliegue (devnet)',
        percent: 100,
        wallet: null, // null = la wallet firmante
        purpose:
          'En devnet no hay pool de liquidez ni mercado. El supply completo queda en la wallet de ' +
          'despliegue para poder probar supply, autoridades y distribución.',
      },
    ],

    authorityPlan: {
      mintAuthority: {
        decision: 'revocar',
        when: 'Tras acuñar el supply completo, en el mismo flujo de creación',
        irreversibleConsequence: IRREVERSIBLE.mint,
      },
      freezeAuthority: {
        decision: 'revocar',
        when: 'En la propia creación del mint (se pasa null)',
        irreversibleConsequence: IRREVERSIBLE.freeze,
      },
      updateAuthority: {
        decision: 'mantener',
        when: 'Se mantiene en devnet para poder iterar la metadata durante las pruebas',
        irreversibleConsequence: IRREVERSIBLE.update,
      },
    },

    metadata: {
      uri: null, // lo rellena `npm run metadata:build` (§4.5)
      imageFile: 'assets/logo.png',
      sellerFeeBasisPoints: 0,
      externalUrl: null,
      // Sin decidir. Ver la nota de §7.6 en CONTEXTO.md: los enlaces sociales
      // son necesarios pero NO suficientes; no generan interés por sí solos.
      socials: { website: null, twitter: null, telegram: null, discord: null },
    },
  },

  // ── Perfil MAINNET: BLOQUEADO a propósito. No tocar sin decidir §7. ────────
  mainnet: {
    name: 'PLACEHOLDER',
    symbol: 'PLACE',
    description: 'Sin decidir. Nombre, ticker y descripción pendientes.',

    tokenProgram: 'sin-decidir', // §4.4

    founderAllocation: {
      decided: false, // §7.1 — NO implementar ningún porcentaje todavía
      optionsUnderReview: [3, 5, 10],
      percent: null,
    },

    allocations: [], // depende de §7.1

    authorityPlan: {
      mintAuthority: {
        decision: 'sin-decidir', // §7.3
        when: 'Tras confirmar que supply y metadata son definitivos',
        irreversibleConsequence: IRREVERSIBLE.mint,
      },
      freezeAuthority: {
        decision: 'sin-decidir', // §7.3
        when: 'Idealmente en la propia creación del mint',
        irreversibleConsequence: IRREVERSIBLE.freeze,
      },
      updateAuthority: {
        decision: 'sin-decidir', // §7.3
        when: 'Solo cuando la metadata sea definitiva',
        irreversibleConsequence: IRREVERSIBLE.update,
      },
    },

    metadata: {
      uri: null, // §4.5
      imageFile: 'assets/logo.png',
      sellerFeeBasisPoints: 0,
      externalUrl: null,
      // Sin decidir. Ver la nota de §7.6 en CONTEXTO.md: los enlaces sociales
      // son necesarios pero NO suficientes; no generan interés por sí solos.
      socials: { website: null, twitter: null, telegram: null, discord: null },
    },
  },
};

const parsed = configSchema.safeParse(raw);
if (!parsed.success) {
  console.error('\n✗ config/token.config.ts es inválido:\n');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const tokenConfig = Object.freeze(parsed.data);

/** Devuelve el perfil correspondiente al cluster. localnet usa el de devnet. */
export function profileFor(cluster: string): TokenProfile {
  return cluster === 'mainnet-beta' ? tokenConfig.mainnet : tokenConfig.devnet;
}

export function profileNameFor(cluster: string): ProfileName {
  return cluster === 'mainnet-beta' ? 'mainnet' : 'devnet';
}

// ── Validación ───────────────────────────────────────────────────────────────

export interface ConfigIssue {
  level: 'error' | 'warn';
  message: string;
}

/**
 * Valida un perfil.
 * `strict` = el perfil va a usarse para crear el token de verdad. Entonces
 * cualquier decisión abierta es un ERROR bloqueante, no un aviso.
 */
export function validateProfile(profileName: ProfileName, strict: boolean): ConfigIssue[] {
  const p = tokenConfig[profileName];
  const issues: ConfigIssue[] = [];
  const openLevel: 'error' | 'warn' = strict ? 'error' : 'warn';

  if (p.tokenProgram === 'sin-decidir') {
    issues.push({ level: openLevel, message: `[${profileName}] tokenProgram sin decidir (§4.4).` });
  }

  if (!p.founderAllocation.decided) {
    issues.push({
      level: openLevel,
      message:
        `[${profileName}] asignación del fundador sin decidir (§7.1). Opciones en estudio: ` +
        `${p.founderAllocation.optionsUnderReview.join('% / ')}%.`,
    });
  } else if (p.founderAllocation.percent === null) {
    issues.push({ level: 'error', message: `[${profileName}] decided=true pero percent es null.` });
  }

  if (p.allocations.length === 0) {
    issues.push({ level: openLevel, message: `[${profileName}] no hay allocations definidas.` });
  } else {
    const sum = p.allocations.reduce((a, x) => a + x.percent, 0);
    if (Math.abs(sum - 100) > 1e-9) {
      issues.push({
        level: 'error',
        message: `[${profileName}] las asignaciones suman ${sum}%, deben sumar exactamente 100%.`,
      });
    }

    // §2.1: no repartir una misma asignación entre wallets para disimular.
    const wallets = p.allocations.map((a) => a.wallet).filter((w): w is string => w !== null);
    if (new Set(wallets).size !== wallets.length) {
      issues.push({
        level: 'error',
        message: `[${profileName}] una misma wallet aparece en varias asignaciones (§2.1).`,
      });
    }

    const founderish = p.allocations.filter((a) => /fundador|founder|team|equipo|dev/i.test(a.label));
    if (founderish.length > 1) {
      issues.push({
        level: 'error',
        message:
          `[${profileName}] la parte del fundador aparece en ${founderish.length} entradas. ` +
          '§2.1 exige UNA sola wallet, visible y verificable.',
      });
    }
  }

  for (const [nombre, plan] of Object.entries(p.authorityPlan)) {
    if (plan.decision === 'sin-decidir') {
      issues.push({ level: openLevel, message: `[${profileName}] autoridad ${nombre} sin decidir (§7.3).` });
    }
  }

  if (p.metadata.uri === null) {
    issues.push({
      level: strict ? 'warn' : 'warn', // se rellena en `metadata:build`, no bloquea la creación del mint
      message: `[${profileName}] metadata.uri sin definir; ejecuta \`npm run metadata:build\` (§4.5).`,
    });
  }

  if (p.name === 'PLACEHOLDER' || p.symbol === 'PLACE') {
    issues.push({ level: openLevel, message: `[${profileName}] nombre/símbolo siguen siendo el marcador.` });
  }

  return issues;
}

/**
 * Puerta de entrada para cualquier script que vaya a CREAR el token.
 * Lanza si el perfil tiene decisiones abiertas.
 */
export function assertProfileReadyForLaunch(profileName: ProfileName): void {
  const errors = validateProfile(profileName, true).filter((i) => i.level === 'error');
  if (errors.length > 0) {
    throw new Error(
      `El perfil "${profileName}" NO está listo para crear el token.\n` +
        errors.map((e) => `  - ${e.message}`).join('\n') +
        '\n\nSon decisiones del operador, no del código. Ciérralas en config/token.config.ts.',
    );
  }
}

/** Supply en unidades base (aplicando decimales). BigInt: no cabe en un Number. */
export function totalSupplyBaseUnits(): bigint {
  return BigInt(tokenConfig.totalSupply) * 10n ** BigInt(tokenConfig.decimals);
}

/** Unidades base que corresponden a una asignación. */
export function allocationBaseUnits(percent: number): bigint {
  // Se calcula en enteros para no perder precisión con floats.
  const total = totalSupplyBaseUnits();
  const basisPoints = BigInt(Math.round(percent * 100)); // 100% → 10000
  return (total * basisPoints) / 10_000n;
}
