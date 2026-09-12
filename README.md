# Hermes

Negociación automática entre agentes de compra y venta de insumos.

Un comercio le pide a su agente comprador que reponga stock. El agente abre 3
negociaciones en paralelo con 3 agentes vendedores (cada uno con su propio
contexto: stock, márgenes, objetivo de rotación). Compiten en precio, plazo de
entrega, plazo de pago y flete — no solo precio. Al final se comparan las 3
ofertas normalizadas y se recomienda una con justificación.

## Problema

Consolidación y validación de precios, y optimización del capital inmovilizado
en stock para comercios. Hoy eso se hace por WhatsApp, con listas de precios
desactualizadas, sin historial y sin ninguna métrica de si conviene comprar
ahora o esperar.

## Estado del proyecto

**Scaffolding inicial.** La UI y los requerimientos de cada vista todavía se
están definiendo — existe un modelo/mockup en HTML como referencia visual
(layout, look and feel), pero qué contiene cada vista (componentes exactos,
datos, interacciones) se va a ir precisando a lo largo del desarrollo. No
tomar lo que hay hoy como spec funcional cerrada.

## Stack

| Capa                       | Elección                                                          |
| -------------------------- | ----------------------------------------------------------------- |
| Frontend                   | Next.js 15 (App Router), TypeScript, Tailwind, shadcn/ui          |
| Estado servidor            | TanStack Query                                                    |
| Forms                      | React Hook Form + Zod                                             |
| Backend                    | Server Actions (dentro del mismo proyecto Next, sin API separada) |
| Base de datos              | Prisma (aún sin modelos definidos)                                |
| Gráficos                   | recharts                                                          |
| Git hooks                  | Husky + lint-staged                                               |
| CI                         | GitHub Actions                                                    |

## Enfoque de datos: mock primero, API real después

Todo el desarrollo arranca con datos mockeados en `lib/mock-data.ts`. Las
server actions de `actions/` devuelven ese mock al principio, con la misma
forma que después va a tener la respuesta real. Cuando el protocolo de
negociación y la lógica de agentes estén listos, se reemplaza el contenido de
la action (mock → Prisma según corresponda) sin tocar `features/` ni
`components/`.

## Estructura

```
hermes/
├── src/
│   ├── app/            # rutas — Negotiation, Negotiations (historial), Dashboard, Settings
│   ├── components/     # presentación, por dominio
│   ├── features/       # hooks + lógica por dominio
│   ├── actions/        # server actions ("use server")
│   ├── lib/            # mock-data, utils
│   └── types/          # tipos del protocolo (a definir)
├── prisma/
│   └── schema.prisma   # datasource + generator, sin modelos todavía
├── .github/workflows/
│   └── ci.yml
└── README.md
```

Nota de nombres: la vista principal se llama **Negotiation** (no "chat") — es
la conversación con el agente comprador que dispara las negociaciones en
paralelo. Es distinta de `negotiations/` (historial y detalle de negociaciones
pasadas) y de `negotiation-settings/` (tab de settings).

## Arranque rápido

```bash
pnpm install
pnpm dev        # http://localhost:3000
```

El proyecto arranca contra datos mockeados (`NEXT_PUBLIC_USE_MOCKS=true`): no
necesita Postgres levantado para desarrollarse.

## Flujo de trabajo

Ramas base `frontend` y `backend`, colgando de `main`; de ahí pueden salir
ramas puntuales por feature. Nunca se commitea directo a `main`. Ver
[CONTRIBUTING.md](./CONTRIBUTING.md) para el detalle y
[WORKFLOW.md](./WORKFLOW.md) para el orden de construcción de una feature.

## Documentación

| Doc                                  | Qué contiene                                                           |
| ------------------------------------ | ---------------------------------------------------------------------- |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Flujo end-to-end y decisiones de stack |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Ramas, PRs, Husky, GitHub Actions, convenciones de código              |
| [AGENTS.md](./AGENTS.md)             | Convenciones del repo para asistentes de código (Codex/Claude/Copilot) |
| [WORKFLOW.md](./WORKFLOW.md)         | Orden concreto para construir una feature nueva                        |
