# Hermes

### El protocolo agent-to-agent para negociar y liquidar comercio B2B

Hermes conecta agentes comerciales autónomos para solicitar cotizaciones, comparar proveedores, aceptar una oferta y ejecutar pagos con trazabilidad completa.

Un agente comprador paga con USDC en Solana. Hermes verifica la transacción, consulta el precio de Twin, calcula fees y liquida ARGt en Arbitrum directamente al proveedor.

```text
Orden de compra → negociación entre agentes → oferta aceptada
        USDC en Solana → Hermes → ARGt en Arbitrum
        Log auditable de toda la operación
```

## Qué ofrece

- Negociación B2B entre agentes y múltiples proveedores.
- Selección automática de la mejor oferta.
- Quotes con precio, fees, vencimiento y monto final.
- Pagos agent-to-agent sin intervención humana durante la ejecución.
- Liquidación cross-chain: USDC/Solana → ARGt/Arbitrum.
- Validación de mint, monto, wallet fuente y cuenta receptora.
- Trazabilidad de estados, firmas, hashes y gas fees.
- Integración con sistemas existentes mediante API y Prisma.

## Demo validada

```text
3 USDC recibidos en Solana
→ precio USDC/ARGt consultado a Twin
→ 4744,258517 ARGt liquidados en Arbitrum
→ proveedor acreditado automáticamente
```

## Estados principales

```text
QUOTE_CREATED → QUOTE_ACCEPTED → SOURCE_PAYMENT_CONFIRMED
→ DESTINATION_PAYMENT_SUBMITTED → DESTINATION_PAYMENT_CONFIRMED → SETTLED
```

## Stack

- Next.js 16 + TypeScript
- Prisma + PostgreSQL/Supabase
- Solana y tokens SPL
- Arbitrum One + ARGt de Twin
- Docker

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

Hermes convierte una intención comercial en una operación ejecutable, verificable y liquidada entre agentes.
