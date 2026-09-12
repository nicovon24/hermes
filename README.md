# Protocolo B2B con Prisma y pagos ARGt

Aplicación Next.js 16 para compras B2B con mandatos, negociación por producto,
adjudicación dividida y pagos automáticos internos en ARGt sobre Arbitrum One.
PostgreSQL puede seguir alojado en Supabase, pero todo el acceso del runtime se
hace con Prisma 6.19; no se usa `@supabase/supabase-js`, PostgREST ni RPC.

## Puesta en marcha

1. Copiá `.env.example` a `.env.local` y configurá `DATABASE_URL` (pooler),
   `DIRECT_URL` (conexión directa), Groq y las variables privadas de pagos.
2. Instalá y generá el cliente:

   ```bash
   npm install
   npm run prisma:generate
   ```

3. En una base vacía, ejecutá `npm run prisma:migrate` y luego
   `npm run prisma:seed`. El seed es repetible y sólo hace upserts.
4. Iniciá la app con `npm run dev`.

No hay endpoints HTTP públicos de pagos. La clave del comprador se usa sólo en
el servidor y nunca se guarda en PostgreSQL.

## Baseline y rollout sobre la base existente

La migración `0_init` representa las 26 tablas actuales, incluyendo checks,
índices parciales, RLS y grants. Para adoptarla sin recrear datos:

```bash
npx prisma migrate resolve --applied 0_init
npx prisma migrate deploy
```

Ese comando debe ejecutarse una sola vez, desde un entorno controlado y después
de un backup. El rollout recomendado es:

1. Marcar la baseline y aplicar `20260912070000_integrate_payments`.
2. Desplegar este runtime Prisma y validar conteos, relaciones y un pago
   controlado. Los pagos heredados conservan `purchase_order_id = null`.
3. Cuando ya no haya una versión anterior de la app en ejecución, promover
   `prisma/post-cutover/20260912080000_remove_legacy_rpc.sql` a la siguiente
   migración Prisma y desplegarla. Se mantiene fuera de la primera tanda para
   que el rollout aditivo no retire prematuramente los RPC.

El historial SQL anterior queda congelado en `supabase/migrations`.

## Pago automático

`Automatic payments` comienza activado. Al aprobar el mandato fija `CONTADO` y
`ARGt`. La adjudicación crea un pago idempotente por orden y el servicio:

- valida todas las wallets, clave compradora, saldo agregado, límite y
  simulaciones antes de transferir;
- envía las órdenes secuencialmente para no colisionar nonces;
- espera confirmaciones y verifica contrato, emisor, destinatario e importe;
- conserva `SUBMITTED` si existe hash pero falta conciliación;
- detiene la secuencia ante la primera falla y exige revisión manual.

## Verificación

El rediseño compartido, el contrato NDJSON y la suite de integración aislada se
describen en [Negociación visual en vivo](docs/negotiation-ui.md).

```bash
npm run prisma:validate
npm run prisma:generate
npm run typecheck
npm run lint
npm test
npm run build
```
