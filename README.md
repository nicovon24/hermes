# Hermes

Hermes es el protocolo **agent-to-agent** de comunicación y negociación para agentes comerciales autónomos.

## Hermes Payments

Esta branch implementa la primera capa del protocolo: solicitud, autorización, envío y verificación de pagos en ARGt sobre Arbitrum One.

```text
POST /payments
  → POST /payments/{id}/authorize
  → POST /payments/{id}/submit
  → POST /payments/{id}/verify
```

Para ejecución agent-to-agent autónoma, configurar una wallet exclusiva del agente:

```bash
export AGENT_PRIVATE_KEY=0x...
export MAX_PAYMENT_BASE_UNITS=30000000000000000000000
```

Luego usar `POST /payments/{id}/execute`. El endpoint valida la wallet, respeta el límite de gasto, firma una transferencia de ARGt y devuelve el `tx_hash`. Nunca commitear `AGENT_PRIVATE_KEY`.

### Ejecutar localmente

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Documentación interactiva: `http://localhost:8000/docs`.

### Ejecutar con Docker

No requiere instalar Python ni dependencias en la máquina:

```bash
docker compose up --build
```

Documentación interactiva: `http://localhost:8000/docs`.

Para detener el container:

```bash
docker compose down
```

### Settlement

```text
Chain ID: 42161
Token: ARGt
Contract: 0x59863989d080B22476DB95656d0C3CC18be92214
Decimals: 18
```
