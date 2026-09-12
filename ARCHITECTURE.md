# Arquitectura

## Flujo end-to-end

```
Usuario (vista Negotiation)
   │  "necesito reponer 200 bolsas de X para fin de mes"
   ▼
Agente comprador ── arma el RFQ a partir del contexto del comercio
   │
   ▼
Orquestador ── dispara 3 negociaciones en paralelo
   ├──► Agente vendedor A ◄──► rondas de QUOTE / COUNTER / CONCESSION
   ├──► Agente vendedor B ◄──►
   └──► Agente vendedor C ◄──►
   │
   ▼
Normalización de las 3 ofertas (costo total, valor presente, capital, cobertura)
   │
   ▼
Recomendación ──► UI: 3 ofertas comparables + explicación
```

Este flujo es el objetivo final. Hoy el proyecto está en etapa de scaffolding:
las vistas existen con placeholders y la lógica de agentes/negociación
todavía no está definida.

## Server-side vs client-side

- **Server Components por defecto.** `'use client'` solo donde hay estado,
  interacción o algo que dependa del navegador.
- **Server Actions en vez de API separada.** Toda la lógica que hoy sería un
  backend aparte vive en `actions/`, dentro del mismo proyecto Next. No hay
  carpeta `backend/` ni servidor HTTP propio.
- **`components/` es solo presentación.** No llama `fetch` ni actions
  directamente — eso pasa por un hook en `features/`.

## Por qué Server Actions y no una API separada

Con un equipo chico y un timeline corto, mantener dos proyectos (API +
frontend) agrega superficie de coordinación (contrato, CORS, deploys
separados) que no se justifica todavía. Server Actions da tipado de punta a
punta sin esa capa. Si más adelante la negociación necesita correr como
servicio independiente (por ejemplo, para escalar el orquestador aparte del
frontend), ahí se separa — pero no antes de que haga falta.

## Mock primero, API real después

Las server actions de `actions/` devuelven datos de `lib/mock-data.ts` con la
misma forma que va a tener la respuesta real. `features/` llama a la action,
nunca al mock directo. Este punto de indirección es lo que permite reemplazar
mock por lógica real sin tocar componentes ni hooks:

```
components/  →  features/ (hook)  →  actions/ (server action)  →  lib/mock-data.ts   [hoy]
components/  →  features/ (hook)  →  actions/ (server action)  →  Prisma             [después]
```

## Dónde entra Prisma

Prisma gestiona la persistencia: contextos de comercio y distribuidores,
negociaciones, mensajes del protocolo y ofertas. Hoy `prisma/schema.prisma`
tiene el datasource (`postgresql`) y el generator configurados, pero sin
modelos — los modelos se definen recién cuando el protocolo de negociación
esté cerrado, para no modelar algo que todavía puede cambiar.

## Streaming en vivo (a futuro)

Si las negociaciones necesitan aparecer en pantalla ronda por ronda a medida
que ocurren, Server Actions no alcanza porque una action es request-response.
En ese momento se evaluará un Route Handler con `ReadableStream` y Server-Sent
Events, sin asumir desde ahora una tecnología de mensajería adicional.

## Stack

| Capa                       | Elección                                                 |
| -------------------------- | -------------------------------------------------------- |
| Frontend                   | Next.js 15 (App Router), TypeScript, Tailwind, shadcn/ui |
| Estado servidor            | TanStack Query                                           |
| Forms                      | React Hook Form + Zod                                    |
| Backend                    | Server Actions                                           |
| Base de datos              | Prisma + PostgreSQL                                      |
| Gráficos                   | recharts                                                 |
| Git hooks                  | Husky + lint-staged                                      |
| CI                         | GitHub Actions                                           |
