# Hermes: interfaz y negociación en vivo

## Diseño

El shell de todas las rutas usa el lenguaje visual de `design/`: fondo `#121212`, superficies translúcidas, navegación lateral y tipografía amplia. El tema se guarda en una cookie de preferencia y se renderiza desde el servidor, sin depender de un cambio de color después de hidratar.

`NegotiationStage` sólo se monta al lanzar un pedido o al recuperar el seguimiento de uno ya lanzado. La entrada de marca se reproduce únicamente en lanzamientos/reintentos, no al recuperar un snapshot. La altura base es `66svh`; en móvil las condiciones se desplazan horizontalmente y la escena final cede su lugar al resumen. Se respetan movimiento reducido, foco y teclado.

Los colores de proveedor son estables (Norte/cian, Andino/ámbar, Sur/violeta). No representan calidad ni éxito. Las mejoras confirmadas usan verde, los objetivos ámbar y los retrocesos coral. Una reducción solicitada no se presenta como ahorro conseguido. Si cambia el conjunto de productos, las cantidades o las unidades, el precio deja de ser comparable.

## Flujo y persistencia

- `LaunchPurchaseFlowInput`: variantes `new`, `approve` y `retry`, validadas con Zod.
- `POST /api/purchase-flow`: NDJSON, JSON y origen del mismo host obligatorios; mantiene el actor comprador fijo de la demo.
- `GET /api/purchase-flow/{requestId}`: snapshot sin caché construido desde mensajes, órdenes, pagos y eventos de dominio persistidos. Sólo expone métricas públicas.
- Los botones y las acciones de servidor delegan a `launchPurchaseFlow`. No hay otra implementación de licitación en la interfaz.
- `requestId` y `operationId` son UUIDs del cliente. El primero evita solicitudes duplicadas y el segundo identifica una ejecución. Los bloqueos de Postgres impiden ejecuciones simultáneas sobre la misma solicitud.
- Las tres conversaciones corren en paralelo, pero cada una mantiene RFQ → oferta → contraoferta → oferta final. Los mensajes conservan claves de idempotencia por ronda/proveedor/fase.
- La adjudicación espera las tres ofertas finales. Una falla conserva las demás conversaciones; el reintento de la misma ronda reutiliza sus mensajes. Los productos no adjudicados se negocian en una nueva ronda.
- Los eventos se publican después del commit. La secuencia es monotónica dentro de cada stream; la identidad estable es `id`, usada para deduplicar y recuperar mensajes entre conexiones.
- Los errores de transporte no se convierten en eventos de negocio. La desconexión del lector no cancela la operación autorizada. Si el servidor continúa trabajando, el cliente consulta snapshots hasta recuperar el cierre.
- La presentación tiene una entrada de 1,2 s, una cadencia normal de 750 ms y acelera con cola. A los 50 s alcanza el último evento recibido y a los 55 s deja de bloquear los controles, sin generar un éxito sintético.
- Las órdenes se muestran antes de esperar pagos. Sus estados se publican después de los commits del servicio de pagos. Un pago fallido se revisa desde el formulario existente; el seguimiento no habilita su reenvío ciego.

El resumen suma exclusivamente las órdenes de la ronda. El ahorro compara las líneas adjudicadas con esas mismas líneas/cantidades/unidades de la oferta inicial del proveedor ganador; no suma ahorros de propuestas perdedoras. La cobertura cuenta productos, nunca cantidades de unidades incompatibles.

No se agregó una migración para el rediseño. La base necesita las migraciones Prisma ya presentes en el proyecto; el procedimiento de baseline de una base existente está en el README.

## Pruebas

`npm test` ejecuta los tests sin escribir en la base configurada por la app. La suite de integración se omite salvo que se indique explícitamente una base aislada:

```bash
HERMES_INTEGRATION_DATABASE_URL='postgresql://hermes_test@127.0.0.1:55439/postgres' npm test
```

Esa base debe haberse creado para pruebas, tener las migraciones y el seed del proyecto. La suite valida el usuario y host de la URL antes de habilitar escrituras. Conserva las solicitudes generadas en esa base para inspección; nunca limpia ni modifica la base compartida. Todos los pagos de la suite usan un gateway simulado, sin conexiones a Arbitrum.

Para una vista manual aislada, se puede configurar `HERMES_BUILD_DIR` con otro directorio de build, sobrescribir `DATABASE_URL` y `DIRECT_URL` con la URL local y abrir otro puerto. Vaciar `AGENT_PRIVATE_KEY`, `PAYMENT_WALLETS_JSON` y `ARBITRUM_RPC_URL` en ese proceso evita que una prueba manual accidental transfiera fondos. Desactivar también `Automatic payments` antes del envío.

Cobertura: métricas de ahorro/cobertura/entrega, baseline cero, NDJSON fragmentado, deduplicación, validación/origen, desconexión, paralelo/serial, idempotencia concurrente, falla/reintento, adjudicación parcial y pagos pendientes/fallidos. La revisión manual incluye desktop y móvil, temas, recuperación al recargar, foco al lanzar y CTA hacia pedidos.
