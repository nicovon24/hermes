<div align="center">

# 🪽 Hermes

### El protocolo agent-to-agent para negociar y liquidar comercio B2B

Agentes comerciales autónomos que cotizan, negocian y pagan entre sí.

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Solana](https://img.shields.io/badge/Solana-USDC-9945FF?logo=solana)](https://solana.com/)
[![Arbitrum](https://img.shields.io/badge/Arbitrum-ARGt-28A0F0?logo=arbitrum)](https://arbitrum.io/)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker)](https://www.docker.com/)

</div>

> **Hermes transforma una intención comercial en una operación ejecutable, verificable y liquidada entre agentes.**

## El problema

Las compras B2B siguen dependiendo de emails, planillas, conciliaciones manuales y pagos lentos. Hermes crea un lenguaje operativo común para que agentes compradores y proveedores puedan negociar y liquidar una operación con evidencia de cada paso.

## Cómo funciona

```mermaid
flowchart LR
    A[Agente comprador] -->|Orden de compra| H[Hermes]
    H -->|RFQ| P1[Proveedor A]
    H -->|RFQ| P2[Proveedor B]
    H -->|RFQ| P3[Proveedor C]
    P1 -->|Oferta| H
    P2 -->|Oferta| H
    P3 -->|Oferta| H
    H -->|Elige mejor oferta| Q[Quote aceptada]
    Q -->|USDC| S[Solana]
    S --> H
    H -->|ARGt| R[Arbitrum]
    R --> V[Proveedor ganador]
```

## Qué ofrece Hermes

| Capacidad | Resultado |
| --- | --- |
| Negociación agent-to-agent | Varios proveedores responden y compiten por una orden |
| Motor de decisión | Selección automática de precio, cobertura y condiciones |
| Quotes | Precio, fees, vencimiento y monto final congelados |
| Liquidación cross-chain | USDC en Solana → ARGt en Arbitrum |
| Trazabilidad | Estados, firmas, hashes y gas fees auditables |
| Pagos autónomos | Ejecución sin intervención humana después de la autorización |

## Demo validada

```text
3 USDC recibidos en Solana
        ↓
Precio USDC/ARGt consultado a Twin
        ↓
4744,258517 ARGt liquidados en Arbitrum
        ↓
Proveedor acreditado automáticamente
```

## Estados de una operación

```text
QUOTE_CREATED
      ↓
QUOTE_ACCEPTED
      ↓
SOURCE_PAYMENT_CONFIRMED
      ↓
DESTINATION_PAYMENT_SUBMITTED
      ↓
DESTINATION_PAYMENT_CONFIRMED
      ↓
SETTLED
```

## Stack

**Aplicación:** Next.js 16 · TypeScript

**Datos:** Prisma · PostgreSQL/Supabase

**Redes:** Solana · tokens SPL · Arbitrum One

**Liquidación:** USDC · ARGt de Twin
**Infraestructura:** Docker

## Inicio rápido

```bash
cp .env.example .env
npm install
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

Con Docker:

```bash
docker compose up -d --build
```

Las claves privadas deben permanecer únicamente en variables de entorno y nunca subirse al repositorio.

## Validación

```bash
npm run prisma:validate
npm run typecheck
npm run lint
npm test
npm run build
```

<div align="center">

**Hermes — commerce, negotiated by agents.**

</div>
