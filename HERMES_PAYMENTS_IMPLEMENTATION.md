# Hermes Payments — Implementación

## Resumen sencillo

Hermes Payments permite que un agente comercial autónomo envíe ARGt a otro agente en Arbitrum y verifique automáticamente que el pago ocurrió.

```text
Agente comprador
  → autoriza un pago
  → Hermes firma y envía ARGt
  → Arbitrum devuelve un tx_hash
  → Hermes verifica la transferencia on-chain
  → Agente proveedor recibe PAYMENT_CONFIRMED
```

Hermes no confía solamente en el mensaje del agente. La confirmación final se obtiene leyendo la blockchain.

## Qué se implementó

- API REST con FastAPI.
- Ejecución dentro de Docker.
- Wallet autónoma del agente comprador.
- Transferencias ERC-20 de ARGt.
- Red Arbitrum One.
- Política de límite máximo por pago.
- Verificación del evento `Transfer`.
- Log de eventos por payment.
- Flujo de estados del pago.

## Red y token

```text
Network: Arbitrum One
Chain ID: 42161
Token: ARGt
Contract: 0x59863989d080B22476DB95656d0C3CC18be92214
Decimals: 18
```

El monto se envía internamente en unidades base. Como ARGt tiene 18 decimales:

```text
1 ARGt     = 1000000000000000000
100 ARGt   = 100000000000000000000
1000 ARGt  = 1000000000000000000000
```

## Componentes

```text
Docker container
  └── FastAPI
        ├── Payment API
        ├── Agent wallet signer
        ├── Arbitrum RPC client
        └── On-chain payment verifier
```

### Payment API

Recibe solicitudes, autoriza pagos, ejecuta transferencias y expone eventos.

### Agent wallet signer

Usa una wallet separada para el agente. La private key se carga mediante `AGENT_PRIVATE_KEY` y nunca debe estar en el código ni en Git.

### Arbitrum RPC client

Consulta Arbitrum mediante:

```text
https://arb1.arbitrum.io/rpc
```

El RPC permite consultar balances, bloques, receipts y eventos de contratos.

### On-chain payment verifier

Busca el evento ERC-20:

```solidity
Transfer(address from, address to, uint256 value)
```

Y comprueba que coincidan todos los datos esperados.

## Estados del pago

```text
PAYMENT_REQUESTED
  → PAYMENT_AUTHORIZED
  → PAYMENT_SUBMITTED
  → PAYMENT_CONFIRMED
```

Si una validación falla, el pago no debe marcarse como confirmado.

### Significado de cada estado

- `PAYMENT_REQUESTED`: se creó una intención de pago.
- `PAYMENT_AUTHORIZED`: la política del agente permite el pago.
- `PAYMENT_SUBMITTED`: la wallet firmó y envió la transacción.
- `PAYMENT_CONFIRMED`: Hermes verificó la transferencia en Arbitrum.

## API

### Crear un pago

```http
POST /payments
```

```json
{
  "conversation_id": "neg-001",
  "payer_agent": "hermes-buyer-agent",
  "payee_agent": "supplier-agent",
  "payer_wallet": "0xAgentWallet",
  "payee_wallet": "0xSupplierWallet",
  "amount_base_units": "100000000000000000000",
  "external_reference": "PO-001"
}
```

Esto crea un pago de 100 ARGt en estado `PAYMENT_REQUESTED`.

### Autorizar

```http
POST /payments/{payment_id}/authorize
```

Hermes valida que el pago esté en estado `PAYMENT_REQUESTED`.

### Ejecutar autónomamente

```http
POST /payments/{payment_id}/execute
```

El endpoint:

1. comprueba que el pago esté autorizado;
2. carga la private key de la wallet del agente;
3. comprueba que la wallet corresponda al `payer_wallet`;
4. verifica el límite máximo configurado;
5. construye una llamada `transfer` del token ARGt;
6. calcula gas EIP-1559;
7. firma localmente;
8. envía la transacción a Arbitrum;
9. devuelve el `tx_hash`.

Este endpoint es el punto que convierte el flujo en agent-to-agent autónomo. No requiere que una persona firme manualmente cada pago.

### Verificar

```http
POST /payments/{payment_id}/verify
```

```json
{
  "tx_hash": "0x..."
}
```

Hermes consulta el receipt y verifica:

```text
✓ chain_id = 42161
✓ transacción exitosa
✓ contrato ARGt correcto
✓ sender correcto
✓ recipient correcto
✓ monto correcto
✓ confirmaciones suficientes
```

### Consultar eventos

```http
GET /payments/{payment_id}/events
```

Cada cambio de estado queda registrado en un timeline.

## Configuración

Crear un archivo `.env` local, nunca commitearlo:

```env
AGENT_WALLET_ADDRESS=0x...
AGENT_PRIVATE_KEY=0x...
ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc
REQUIRED_CONFIRMATIONS=1
MAX_PAYMENT_BASE_UNITS=1000000000000000000000
```

El límite anterior equivale a 1.000 ARGt por pago.

La wallet del agente también necesita ETH en Arbitrum para pagar gas.

## Ejecución con Docker

No hace falta instalar Python ni Web3 en la máquina host.

```bash
docker compose up --build
```

API:

```text
http://localhost:8000
```

Swagger:

```text
http://localhost:8000/docs
```

Detener:

```bash
docker compose down
```

## Prueba realizada

Se ejecutó exitosamente una transferencia autónoma de 100 ARGt:

```text
Payer:  wallet autónoma de Hermes
Payee:  0x3f0e3d8e86435a07a1d61532e004a86e722f5de0
Token:  ARGt
Red:    Arbitrum One
Monto:  100 ARGt
Estado: PAYMENT_CONFIRMED
```

Transacción:

```text
0x17a51caa676f937c37f7dfe63a7d6244fa915c9e9182ec2819b0a12dfab41ac2
```

La verificación confirmó que el token, las wallets y el monto coincidían. La transacción tenía 65 confirmaciones al momento de verificar; el mínimo configurado para el MVP era 1.

## Seguridad

- Nunca commitear `.env`.
- Nunca compartir `AGENT_PRIVATE_KEY`.
- Usar una wallet separada de las wallets personales.
- Mantener un límite de gasto bajo.
- Validar siempre `chain_id` y `token_address`.
- No permitir que un LLM firme pagos sin pasar por políticas determinísticas.
- Probar primero con montos pequeños.
- Para producción, usar un secret manager o smart account.

## Limitaciones actuales

- Los payments se guardan en memoria; al reiniciar el container se pierden.
- El log usa un identificador como hash provisional; falta implementar SHA-256 canónico.
- El RPC público puede tener límites de uso.
- No hay escrow.
- No hay recuperación automática ante una transacción pendiente.
- La política todavía tiene un límite global, no límites por proveedor.
- No hay integración ERP/CRM todavía.

## Próximos pasos

1. Persistir payments y eventos en PostgreSQL.
2. Implementar hash chain real.
3. Agregar idempotencia para `tx_hash`.
4. Esperar confirmaciones antes de marcar settlement final.
5. Agregar webhooks agent-to-agent.
6. Agregar escrow para liberar pagos contra entrega.
7. Usar smart accounts o un secret manager para producción.

