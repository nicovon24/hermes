# Arquitectura de comunicación

## Decisión

PostgreSQL alojado en Supabase es la fuente de verdad. Next.js es la frontera de entrada y no contiene reglas duplicadas:

- Server Components leen con el cliente Prisma, que sólo existe en el servidor.
- Server Actions reciben mutaciones de la interfaz, fijan el único cliente demo y llaman servicios de dominio.
- La acción de licitación ejecuta tres agentes vendedores en paralelo y un agente comprador que contraoferta y compara.
- Funciones transaccionales de Postgres escriben el agregado, la auditoría y el evento de dominio en una sola transacción.
- Groq propone términos comerciales; Zod, las políticas y los cálculos determinísticos los validan antes de persistirlos.

```text
UI cliente ──Server Action── orquestador de licitación
                                  ├── 3 agentes vendedor Groq (paralelo)
                                  ├── 1 agente comprador Groq
                                  └── servicios Prisma ── PostgreSQL
                                                           ├── mensajes
                                                           ├── ofertas y métricas
                                                           └── auditoría y eventos
```

Una Server Action no es una API pública estable: está ligada al build de Next y está pensada para esta UI. En este prototipo no hay API externa, broker ni segundo backend.

## Contrato del mensaje

El contrato canónico está en `src/modules/protocol/domain/message.ts`. Todos los mensajes contienen:

| Campo | Uso |
|---|---|
| `messageId` | Identidad global del mensaje. |
| `protocolVersion` | Versión semántica del contrato; el MVP acepta `1.0`. |
| `type` | Tipo de evento de negocio. |
| `senderCompanyId` / `recipientCompanyId` | Participantes autenticados. |
| `purchaseRequestId` / `negotiationId` | Correlación de negocio. |
| `correlationId` | Mensaje anterior al que responde, si existe. |
| `sentAt` / `expiresAt` | Temporalidad explícita. |
| `idempotencyKey` | Deduplicación dentro del emisor. |
| `payload` | Carga validada según `type`. |

La clave única `(sender_company_id, idempotency_key)` evita reprocesar reintentos. Un duplicado devuelve el `messageId` procesado previamente. En la demo, la Server Action valida que el emisor sea una de las cuatro empresas mock.

## Modelo de escritura

Las tablas tienen RLS sin políticas para navegador. Anónimo y `authenticated` no tienen permisos; toda lectura y escritura pasa por el servidor mediante `service_role`. En esta etapa no hay usuarios ni sesiones: `src/lib/demo-workspace.ts` fija a `Almacén Punto Centro` como único comprador autorizado por las Server Actions.

Las cuatro cuentas mock sí tienen páginas públicas de demo (`/[companySlug]`). Esto permite desarrollar las vistas del cliente y de cada distribuidor por separado, pero no representa aislamiento de seguridad para producción.

Los comandos principales son:

- `create_purchase_request_command`: crea solicitud, líneas, auditoría y `purchase_request.approval_required`.
- `approve_purchase_request_command`: bloquea la solicitud, crea el mandato y una negociación por proveedor, transiciona a `NEGOTIATING` y emite el evento.
- `append_protocol_message_command`: bloquea la negociación, deduplica, guarda el mensaje, normaliza ofertas y emite el evento.
- `record_agent_recommendation_command`: conserva entrada/salida del agente y transiciona a `RECOMMENDED` sólo si el resultado fue aceptado.
- `record_supplier_agent_run_command`: conserva la entrada y salida de cada ronda de cada vendedor.
- `record_negotiation_metrics_command`: registra o actualiza la analítica final de cada conversación.

Los importes se transportan como strings decimales y se almacenan como `numeric`. La política compara unidades mínimas con `BigInt`, sin `Number` ni coma flotante.

## Debate entre agentes

Cada proveedor tiene una negociación independiente. Las tres se ejecutan en
paralelo, pero nunca comparten el contexto privado de otro proveedor:

1. El comprador envía un `request_for_quote` con producto, cantidades, fecha y condición de pago.
2. Cada vendedor usa su stock, costo, historial con ese cliente, margen y rotación para enviar `offer`.
3. El comprador compara las tres propuestas con sus ventas, cobertura y objetivo de capital, y envía una `counteroffer` distinta a cada uno.
4. Cada vendedor responde `final_offer` respetando un piso de margen bruto calculado en el servidor.
5. Las ofertas que cumplen mandato, vigencia y stock se ordenan; el comprador presenta ranking 1–3 y recomendación.

Cada respuesta usa `correlationId` para enlazarla con el mensaje anterior. Una
falla de un proveedor no cancela las conversaciones que sí respondieron.

## Contextos privados

El comprador usa su historial de ventas, tendencia de 30 días, stock disponible
y en tránsito, días objetivo de cobertura y capital objetivo en inventario. El
vendedor usa únicamente su historial de ventas a ese cliente, stock disponible,
costo, margen objetivo y días objetivo de rotación.

El contexto completo nunca se escribe dentro del mensaje comercial. Sólo se
registra como `input_snapshot` privado de la ejecución del agente para poder
auditar por qué produjo una propuesta.

## Groq

El modelo por defecto es `openai/gpt-oss-20b`, configurable mediante `GROQ_MODEL`. Todas las respuestas usan Structured Output estricto. Antes de recomendar, las ofertas finales pasan estas reglas:

- proveedor permitido;
- moneda correcta;
- stock confirmado;
- oferta y mandato vigentes;
- total dentro del mandato.

Los agentes no conocen credenciales de pago, no firman transacciones y no pueden llamar el comando de aceptación. El servidor recalcula impuestos, total, stock confirmado y piso de margen; no confía en importes o IDs inventados por el modelo.

## Analítica

`negotiation_metrics` guarda por proveedor: rondas, cantidad de mensajes, total
inicial y final, reducción porcentual, margen estimado, eficiencia respecto del
tope de capital, stock disponible y duración. `/protocol` agrega respuesta 3/3,
mejor total, brecha entre propuestas, baja promedio y mensajes trazados.

## Comunicación sin broker

No hay NATS, colas ni relay. Dentro de la aplicación, cada intención entra por una Server Action y espera el resultado del comando transaccional. `revalidatePath` vuelve a leer el estado confirmado mediante Prisma.

`domain_events` es un registro append-only para trazabilidad; no funciona como cola ni dispara acciones posteriores. Una acción compuesta debe llamar explícitamente al siguiente servicio y devolver un error si ese paso falla. Las operaciones monetarias futuras mantendrán idempotencia propia para poder reintentarse de manera segura desde otra Server Action.

No existe una frontera externa en esta etapa. El cliente crea y lanza desde `/protocol`; las páginas `/<slug>` de los proveedores muestran su contexto y el resultado de su agente, sin botones de confirmación.

## Próximos comandos críticos

La base implementada cubre comunicación, solicitud, mandato, negociación, oferta y recomendación. Antes de mover dinero deben agregarse, en este orden:

1. `validate_policy_command` con versión esperada del mandato y la oferta.
2. `reserve_funds_command` que bloquee cuenta y presupuesto y registre doble entrada.
3. `accept_offer_command` que revalide vigencia/stock y consuma el mandato.
4. `create_payment_intent_command` con idempotencia del proveedor de pagos.
5. Server Action de ejecución que llama al servicio de pagos autorizado; el modelo jamás recibe claves ni firma.
6. Conciliación y devolución como transacciones nuevas, nunca como borrado del pago.
