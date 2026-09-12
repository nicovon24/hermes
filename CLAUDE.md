@AGENTS.md

# Hermes — guía para agentes

Protocolo de compras B2B sobre Next.js 16 (App Router, Turbopack), Prisma 6 y
pagos on-chain (ARGt en Arbitrum, SPL en Solana). El README describe el dominio
y el rollout de migraciones; acá va sólo lo que hace falta para trabajar sin romper nada.

## Estructura: todo vive en `src/`

- **Nunca crees una carpeta `app/` en la raíz del repo.** Next ignora `src/app`
  por completo si existe un `app/` en la raíz, y toda la app devuelve 404 en dev.
  Ya pasó una vez (PR #10). Las rutas API van en `src/app/api/...`.
- `src/app` páginas y rutas API · `src/components` UI · `src/lib` infraestructura
  (prisma, env, chain, solana, settlement) · `src/modules/{protocol,payments,context}`
  lógica de dominio. Cada módulo tiene su propio README.
- Alias `@/*` → `src/*` (tsconfig y vitest).
- `supabase/migrations` es historial SQL congelado. Las migraciones vivas son las de `prisma/`.

## Antes de levantar dev

```bash
npm install
npm run prisma:generate   # sin esto las páginas devuelven 500, no 404
npm run dev
```

Las variables se leen de `.env` / `.env.local` (ver `.env.example`). La app
necesita `DATABASE_URL` y `DIRECT_URL`; sin DB las páginas que consultan Prisma fallan.

## Verificar sin pisar el workspace

`next.config.ts` lee `HERMES_BUILD_DIR` para elegir el `distDir`. Para un
servidor de verificación aislado mientras el dev principal corre en :3000:

```bash
HERMES_BUILD_DIR=.next-verify npx next dev -p 3999
```

Borrá `.next-verify` al terminar. Ojo: `next dev` puede agregar entradas
`include` en `tsconfig.json` para ese distDir y reescribir `next-env.d.ts`;
revertí esos cambios antes de commitear salvo que sean intencionales.

## Checks antes de un PR

```bash
npm run typecheck
npm run lint
npm test          # vitest, environment node; integración aislada está skipped por defecto
```

Los tests de integración de Prisma (`tests/purchase-flow.integration.test.ts`)
corren sólo si está definida `HERMES_INTEGRATION_DATABASE_URL`; sin esa variable quedan skipped.

## Convenciones

- Ramas `fix/...` / `feat/...`, PRs contra `master`.
- Rutas API validan input y devuelven `{ error }` con 400 para errores de
  cliente y 502 para fallas de red/cadena. Seguí ese patrón.
- Las claves privadas (`AGENT_PRIVATE_KEY`, `SOLANA_AGENT_PRIVATE_KEY`) sólo se
  usan en servidor. No las expongas en componentes ni en respuestas.
