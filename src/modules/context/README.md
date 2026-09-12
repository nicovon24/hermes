# Módulo Context

Este módulo representa la realidad privada de cada empresa. Responde preguntas como: ¿cuánto stock hay?, ¿qué se vendió?, ¿de qué ERP vino el dato? y ¿qué versión estamos mirando?

## Estructura

```text
context/
├── analytics.ts       proyecciones privadas para agentes comprador/vendedor
├── schema.ts          valida snapshots de inventario y ventas
├── service.ts         ejecuta los comandos transaccionales con Prisma
├── actions.ts         Server Actions que usa la interfaz
├── inventory-form.tsx formulario de carga de inventario
└── sale-form.tsx      formulario de carga de ventas
```

El esquema vigente está en `prisma/schema.prisma`; el SQL anterior queda congelado como historial. Sus tablas son:

- `companies`: el cliente y los tres distribuidores, cada uno con su `slug` de página.
- `context_sources`: ERP/API de origen, última versión y fecha observada.
- `products`: catálogo privado de cada empresa.
- `inventory_snapshots`: historial inmutable de stock físico, reservado y en tránsito.
- `sales_events`: ventas deduplicadas; para proveedores puede identificar al cliente.
- `company_objectives`: capital y cobertura del cliente; margen y rotación de proveedores.
- `context_events`: registro de actualizaciones recibidas; no es una cola.

Regla de propiedad: este módulo no importa nada desde `protocol`. El protocolo puede usar una proyección mínima del contexto, pero no leer ni enviar el historial privado completo.

Las migraciones `003` y `006` cargan productos, costos, stock, historiales y objetivos de ejemplo. No hay login: las páginas por cuenta sólo sirven para desarrollar y recorrer la demo.
