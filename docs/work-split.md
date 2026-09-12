# Cómo dividir el trabajo entre dos personas

## Persona A — Contexto

Trabaja en `src/modules/context`, la pantalla `/context` y las migraciones de contexto `001`, `003` y `006`.

Su responsabilidad es recibir datos del ERP, conservar su origen y versión y producir una vista confiable de productos, inventario, ventas y objetivos. No decide cómo negociar ni qué información se comparte con proveedores.

Su salida estable hacia Protocolo son dos funciones de sólo lectura de
`src/modules/context/analytics.ts`:

- `getBuyerProductContext`: tendencia, demanda diaria, cobertura, compra sugerida y capital en stock.
- `getSupplierProductContext`: stock, costo, historial con el cliente, margen y rotación objetivo.

Próximas tareas naturales:

1. Conectar el primer ERP real.
2. Agregar pedidos abiertos y demanda estimada.
3. Mejorar demanda, días de cobertura y punto de reposición.
4. Detectar datos desactualizados o versiones fuera de orden.
5. Entregar al protocolo una proyección mínima para crear una solicitud.

## Persona B — Protocolo

Trabaja en `src/modules/protocol`, la pantalla `/protocol`, las páginas de distribuidores y las migraciones `002`, `004`, `005` y `007`.

Su responsabilidad es convertir una necesidad aprobada en tres negociaciones trazables: RFQ, ofertas, contraofertas, políticas, métricas, recomendación y estados. No debe modificar stock ni historiales de ventas.

`src/modules/protocol/services/tender.ts` es el orquestador. Llama Contexto sólo
para obtener proyecciones ya calculadas; ejecuta vendedores en paralelo y nunca
escribe en tablas de inventario o ventas.

Próximas tareas naturales:

1. Agregar límites de rondas, tiempo y costo por licitación.
2. Implementar reintentos por proveedor y estado visible de fallas parciales.
3. Agregar comandos específicos de aceptación y rechazo.
4. Implementar reserva de fondos y presupuesto con locks.
5. Conectar pago y conciliación sin exponer claves a Groq.

## Datos mock compartidos

La migración `202609110003_demo_data.sql` crea el cliente activo, los tres distribuidores, sus catálogos y su stock. Ambos pueden ampliarla, pero deben coordinar cambios porque alimenta las dos pantallas.

## Archivos compartidos

Los dos módulos usan `src/lib/demo-workspace.ts`, `src/lib/prisma.ts`, `src/lib/env.ts`, `src/lib/workspace.ts`, las páginas `/[companySlug]`, el layout y los estilos globales. Conviene avisarse antes de modificar esos archivos.

La dependencia permitida es:

```text
shared ← context
shared ← protocol
context → proyección mínima → protocol
```

`protocol` nunca escribe las tablas de contexto. `context` nunca importa ni escribe solicitudes, negociaciones u ofertas. La única flecha entre ambos es la proyección de analítica de sólo lectura.
