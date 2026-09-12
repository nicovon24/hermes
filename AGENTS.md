# AGENTS.md

Instrucciones para cualquier asistente de código (Codex, Claude, Copilot,
etc.) que trabaje en este repo. Leer esto antes de tocar código.

## Qué es este proyecto

Hermes simula negociaciones automáticas entre un agente comprador y tres
agentes vendedores. Ver [README.md](./README.md) y
[ARCHITECTURE.md](./ARCHITECTURE.md) para el contexto completo.

## Estado del proyecto — leer antes de asumir nada

- **La UI y los requerimientos de cada vista todavía están en definición.**
  Existe un modelo HTML de referencia visual, pero define look and feel, no
  qué componentes o datos tiene cada pantalla. No asumas que una lista de
  componentes es final — confirmá contra quien te dio la tarea.
- **No inventes modelos de Prisma ni tipos del protocolo de negociación**
  hasta que estén explícitamente definidos. Si necesitás un tipo que todavía
  no existe, preguntá o dejá el punto señalado, no lo inventes.

## Nombres

La vista principal se llama **Negotiation**, no "chat". Es la conversación
con el agente comprador que dispara las negociaciones en paralelo. No es lo
mismo que:

- `negotiations/` — historial y detalle de negociaciones pasadas.
- `negotiation-settings/` — tab de settings con máx. rondas, plazo de pago, etc.

No uses "chat" en ningún nombre nuevo de carpeta, archivo, componente o
variable.

## Estructura de carpetas

```
src/
├── app/            # rutas (App Router)
├── components/     # solo presentación, por dominio
├── features/       # hooks + lógica de dominio, llaman a las actions
├── actions/        # server actions ("use server"), una por dominio
├── lib/            # mock-data, utils
└── types/          # tipos compartidos (protocolo de negociación, a definir)
```

Reglas:

- **Server Components por defecto.** `'use client'` solo si hay estado,
  interacción o algo que dependa del navegador.
- **`components/` no llama `fetch` ni actions directamente.** Pasa por un
  hook de `features/`.
- **Un componente nuevo va en `components/<dominio>/`**, no suelto en
  `components/`.
- **Una server action nueva va en `actions/<dominio>.ts`**, agrupada por
  dominio, no una por endpoint.

## Mock primero, API real después

Las server actions hoy devuelven datos de `lib/mock-data.ts`. Cuando agregues
o modifiques una action:

- Mantené la misma forma de respuesta que va a tener la versión real — eso es
  lo que permite reemplazar mock por Prisma sin tocar `features/` ni
  `components/`.
- No conectes Prisma a una action todavía salvo que se te pida explícitamente
  — mientras el protocolo no esté cerrado, seguí devolviendo mock.

## Git y ramas

- Ramas base: `frontend` y `backend`, ambas colgando de `main`. Podés abrir
  otras ramas puntuales desde cualquiera de las dos para una feature
  específica; esas mergean de vuelta a su rama base.
- **Nunca commitees directo a `main`.** Todo cambio entra por pull request.
- Antes de abrir el PR, corré localmente lo mismo que corre CI: `pnpm lint`
  y `pnpm build`.

Ver [CONTRIBUTING.md](./CONTRIBUTING.md) para el detalle completo y
[WORKFLOW.md](./WORKFLOW.md) para el orden paso a paso de cómo construir una
feature dentro de este repo.

## Qué NO hacer

- No commitear directo a `main`.
- No llamar `fetch` desde `components/`.
- No definir modelos de Prisma ni tipos del protocolo de negociación sin que
  estén cerrados.
- No usar "chat" para nombrar nada nuevo.
- No asumir que el HTML modelo define el contenido funcional final de una
  vista.
