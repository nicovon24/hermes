# Módulo Protocol

Este módulo representa lo que dos empresas se comunican y acuerdan. Responde preguntas como: ¿qué se pidió?, ¿quién puede aprobarlo?, ¿qué ofreció cada proveedor? y ¿por qué Groq recomendó una opción?

## Estructura

```text
protocol/
├── domain/
│   ├── message.ts     contrato v1.0 de todos los mensajes
│   ├── commands.ts    datos válidos para crear y aprobar solicitudes
│   └── policy.ts      reglas determinísticas aplicadas a las ofertas
├── services/
│   ├── purchase-requests.ts
│   ├── negotiations.ts
│   └── tender.ts       orquesta las tres discusiones paralelas
├── actions/
│   ├── purchase-requests.ts
│   └── negotiations.ts
└── agent/
    └── groq.ts        vendedor, contraoferta y ranking estructurados
```

El esquema vigente está en `prisma/schema.prisma`; `supabase/migrations` queda congelado como historial. Sus tablas principales son:

- `purchase_requests` y `purchase_request_items`: qué necesita el comprador.
- `mandates`: qué aprobó una persona y cuáles son los límites.
- `negotiations` y `negotiation_messages`: conversación independiente con cada proveedor.
- `offers`: versión normalizada de ofertas vigentes e históricas.
- `agent_runs`: entrada y salida verificable de Groq.
- `negotiation_metrics`: resultado analítico de cada discusión.
- `domain_events` y `audit_log`: cambios de estado y trazabilidad.

Regla de seguridad: las salidas de Groq se validan con JSON Schema y Zod. El servidor fija IDs, confirma stock, recalcula totales e impuestos, impone el margen mínimo y filtra por mandato. Las aceptaciones, reservas y pagos deben tener Server Actions y comandos específicos; nunca se ejecutan por texto generado por el modelo.

En la demo, `Almacén Punto Centro` es el único comprador y los otros tres registros de `companies` son distribuidores fijos. No hay login. Al lanzar la licitación, los tres vendedores responden automáticamente, el comprador contraoferta y presenta las opciones ordenadas. Cada distribuidor abre su página para ver su stock, objetivos, historial con el cliente y propuesta vigente; no confirma manualmente.
