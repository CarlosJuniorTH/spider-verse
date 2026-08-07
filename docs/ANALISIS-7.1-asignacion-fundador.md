# §7.1 — Asignación del fundador: 3 % / 5 % / 10 %

> Análisis pedido por CONTEXTO.md §7.1. **No implementa nada.** El perfil de
> mainnet sigue con `founderAllocation.decided = false` y el código lo bloquea
> hasta que el operador decida.
>
> Separo lo **verificable** de lo que es **juicio**. Lo marco explícitamente.

---

## 1. El planteamiento correcto de la pregunta

La pregunta no es "¿qué porcentaje me quedo?". Es:

> **¿Qué porcentaje puedo defender públicamente cuando un desconocido mire mi
> wallet en Solscan a los diez minutos de lanzar?**

Porque va a pasar. Con la Opción B del [FASE 6](FASE6-mecanismos.md), la
distribución es pública desde el primer bloque y este mismo repositorio incluye
la herramienta para auditarla (`npm run inspect:distribution`), que también puede
usar cualquiera contra nosotros.

---

## 2. Hecho verificable: dónde acaba el supply

Con un token propio y pool en un DEX, el supply se reparte así:

```
supply total
├── al pool de liquidez  → lo controla el AMM, no tú
└── a tu wallet          → tu asignación, visible como un único holder
```

Esto tiene una consecuencia que suele pasarse por alto:

**Lo que no metes en el pool, lo tienes tú.** No hay un tercer sitio donde
"guardar" tokens sin que aparezcan en la lista de holders. Si te quedas el 10 %,
en la pestaña de holders sale una wallet con el 10 %. No hay forma honesta de que
no salga — y las formas deshonestas (trocear entre wallets) están prohibidas por
§2.1 y las detecta el propio verificador de este repo.

**Hecho verificable adicional:** los agregadores suelen excluir la cuenta del pool
del cálculo de concentración, porque no es un tenedor real. Eso significa que **tu
asignación se mide contra el supply circulante, no contra el total**, y por tanto
*se ve más grande* de lo que el porcentaje sobre el total sugiere.

---

## 3. Comparativa

Supply de referencia: 1.000.000.000.

| | **3 %** | **5 %** | **10 %** |
| --- | --- | --- | --- |
| Tokens | 30.000.000 | 50.000.000 | 100.000.000 |
| Cómo se lee | "simbólico" | "razonable" | "el dev tiene una posición grande" |
| Presión de venta percibida | Baja | Media | **Alta** |
| Margen para errores de comunicación | Amplio | Medio | **Ninguno** |
| Si además hay lock (§7.2) | Casi irrelevante | Neutro/positivo | **Pasa de bandera roja a aceptable** |

### Lo que es juicio, no dato

Los siguientes puntos son **mi valoración**, no cifras verificables. Los umbrales
concretos de los analizadores automáticos cambian y no los he podido confirmar en
documentación oficial, así que no invento números:

- Por encima del ~10 % en una sola wallet, el escrutinio deja de ser sobre el
  proyecto y pasa a ser sobre ti. Cada venta tuya será noticia.
- Entre el 3 % y el 5 %, la asignación deja de ser el tema de conversación.
- El daño de un porcentaje alto **no es el porcentaje**: es que te obliga a
  justificarte continuamente, y cada justificación reabre la sospecha.

---

## 4. La variable que casi nadie considera

**Un 10 % bloqueado es más creíble que un 3 % líquido.**

Un 3 % sin lock puede venderse entero mañana. Un 10 % con vesting público y
verificable no puede. La *credibilidad* no la da el número: la da la
**imposibilidad de hacer daño**, y eso se demuestra con mecanismos, no con
promesas — que es exactamente la filosofía del §1 de este proyecto.

Esto conecta directamente con §7.2 (vesting/lock), que sigue abierto.

---

## 5. Recomendación

**5 %, en una sola wallet, etiquetada públicamente, y con lock si §7.2 lo permite
a coste 0.**

Razones:

1. Es defendible sin esfuerzo. No exige un discurso.
2. Sobre 1.000 millones son 50 millones de tokens: suficiente para que el
   fundador tenga participación real en el resultado.
3. Deja margen: si el proyecto funciona, nadie discutirá un 5 %. Si no funciona,
   el 5 % tampoco te habría salvado.
4. El 10 % solo tiene sentido **si va acompañado de lock verificable**. Sin lock,
   el coste reputacional supera al beneficio.
5. El 3 % es una opción perfectamente razonable si prefieres eliminar el tema por
   completo; el coste es tener menos exposición al éxito.

**No es una decisión técnica y no la tomo yo.** Cuando decidas, se cierra así en
`config/token.config.ts`, perfil `mainnet`:

```ts
founderAllocation: { decided: true, optionsUnderReview: [], percent: 5 },
allocations: [
  { label: 'Fundador', percent: 5, wallet: '<TU_PUBKEY>',
    purpose: 'Participación del fundador. Wallet única y pública.' },
  { label: 'Liquidez inicial', percent: 95, wallet: '<WALLET_LP>',
    purpose: 'Se aporta íntegramente al pool de liquidez.' },
],
```

El validador comprobará que suman 100 %, que no hay wallets repetidas y que la
parte del fundador no está troceada (§2.1).

---

## 6. Lo que queda abierto y bloquea esta decisión

- **§7.2 vesting/lock** — hay que verificar si existe una opción **gratuita** y
  **públicamente verificable por terceros**. Si la hay, el 10 % vuelve a estar
  sobre la mesa. Si no la hay, la recomendación se queda en 5 %.
- **Capital de liquidez** — la [FASE 6](FASE6-mecanismos.md) §3 explica por qué
  esta cifra condiciona todo el lanzamiento, incluida esta decisión.
