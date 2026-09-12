import os
from enum import Enum
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from web3 import Web3

CHAIN_ID = 42161
ARGT_ADDRESS = "0x59863989d080B22476DB95656d0C3CC18be92214"
RPC_URL = os.getenv("ARBITRUM_RPC_URL", "https://arb1.arbitrum.io/rpc")
REQUIRED_CONFIRMATIONS = int(os.getenv("REQUIRED_CONFIRMATIONS", "1"))
AGENT_PRIVATE_KEY = os.getenv("AGENT_PRIVATE_KEY")
MAX_PAYMENT_BASE_UNITS = int(os.getenv("MAX_PAYMENT_BASE_UNITS", "30000000000000000000000"))
web3 = Web3(Web3.HTTPProvider(RPC_URL))

ERC20_ABI = [{
    "anonymous": False,
    "inputs": [
        {"indexed": True, "name": "from", "type": "address"},
        {"indexed": True, "name": "to", "type": "address"},
        {"indexed": False, "name": "value", "type": "uint256"},
    ],
    "name": "Transfer",
    "type": "event",
}, {
    "inputs": [{"name": "to", "type": "address"}, {"name": "value", "type": "uint256"}],
    "name": "transfer",
    "outputs": [{"name": "", "type": "bool"}],
    "stateMutability": "nonpayable",
    "type": "function",
}]

app = FastAPI(title="Hermes Payments", version="0.1.0")
payments: dict[str, dict[str, Any]] = {}


class PaymentStatus(str, Enum):
    REQUESTED = "PAYMENT_REQUESTED"
    AUTHORIZED = "PAYMENT_AUTHORIZED"
    SUBMITTED = "PAYMENT_SUBMITTED"
    CONFIRMED = "PAYMENT_CONFIRMED"


class PaymentCreate(BaseModel):
    conversation_id: str
    payer_agent: str
    payee_agent: str
    payer_wallet: str
    payee_wallet: str
    amount_base_units: str = Field(pattern=r"^[0-9]+$")
    external_reference: str | None = None


class TxRequest(BaseModel):
    tx_hash: str = Field(pattern=r"^0x[a-fA-F0-9]{64}$")


def get_payment(payment_id: str) -> dict[str, Any]:
    payment = payments.get(payment_id)
    if not payment:
        raise HTTPException(404, "Payment not found")
    return payment


def add_event(payment: dict[str, Any], event_type: str, data: dict[str, Any]) -> None:
    previous = payment["events"][-1]["hash"] if payment["events"] else None
    event_id = f"evt-{uuid4().hex[:12]}"
    payment["events"].append({
        "event_id": event_id,
        "event_type": event_type,
        "data": data,
        "previous_hash": previous,
        # TODO: replace with canonical SHA-256 hash chain.
        "hash": event_id,
    })


@app.get("/health")
def health() -> dict[str, Any]:
    return {"service": "hermes-payments", "status": "ok", "chain_id": CHAIN_ID}


@app.post("/payments", status_code=201)
def create_payment(request: PaymentCreate) -> dict[str, Any]:
    payment_id = f"pay-{uuid4().hex[:12]}"
    payment = {
        "payment_id": payment_id,
        "status": PaymentStatus.REQUESTED,
        "chain_id": CHAIN_ID,
        "token_address": ARGT_ADDRESS,
        "data": request.model_dump(),
        "tx_hash": None,
        "events": [],
    }
    add_event(payment, PaymentStatus.REQUESTED, {})
    payments[payment_id] = payment
    return payment


@app.get("/payments/{payment_id}")
def read_payment(payment_id: str) -> dict[str, Any]:
    return get_payment(payment_id)


@app.post("/payments/{payment_id}/authorize")
def authorize_payment(payment_id: str) -> dict[str, Any]:
    payment = get_payment(payment_id)
    if payment["status"] != PaymentStatus.REQUESTED:
        raise HTTPException(409, "Payment is not awaiting authorization")
    payment["status"] = PaymentStatus.AUTHORIZED
    add_event(payment, PaymentStatus.AUTHORIZED, {})
    return payment


@app.post("/payments/{payment_id}/submit")
def submit_payment(payment_id: str, request: TxRequest) -> dict[str, Any]:
    payment = get_payment(payment_id)
    if payment["status"] != PaymentStatus.AUTHORIZED:
        raise HTTPException(409, "Payment must be authorized before submission")
    payment["tx_hash"] = request.tx_hash
    payment["status"] = PaymentStatus.SUBMITTED
    add_event(payment, PaymentStatus.SUBMITTED, {"tx_hash": request.tx_hash})
    return payment


@app.post("/payments/{payment_id}/execute")
def execute_payment(payment_id: str) -> dict[str, Any]:
    """Sign and submit an ARGt transfer from the Hermes agent wallet."""
    payment = get_payment(payment_id)
    if payment["status"] != PaymentStatus.AUTHORIZED:
        raise HTTPException(409, "Payment must be authorized before execution")
    if not AGENT_PRIVATE_KEY:
        raise HTTPException(503, "AGENT_PRIVATE_KEY is not configured")
    amount = int(payment["data"]["amount_base_units"])
    if amount > MAX_PAYMENT_BASE_UNITS:
        raise HTTPException(403, "Payment exceeds agent wallet policy limit")
    if not web3.is_connected():
        raise HTTPException(502, "Arbitrum RPC is not reachable")

    account = web3.eth.account.from_key(AGENT_PRIVATE_KEY)
    if account.address.lower() != payment["data"]["payer_wallet"].lower():
        raise HTTPException(403, "Agent key does not match payer wallet")

    token = web3.eth.contract(address=web3.to_checksum_address(ARGT_ADDRESS), abi=ERC20_ABI)
    latest_block = web3.eth.get_block("latest")
    base_fee = latest_block.get("baseFeePerGas", web3.eth.gas_price)
    priority_fee = max(web3.to_wei(0.01, "gwei"), web3.eth.max_priority_fee)
    transaction = token.functions.transfer(
        web3.to_checksum_address(payment["data"]["payee_wallet"]), amount
    ).build_transaction({
        "from": account.address,
        "nonce": web3.eth.get_transaction_count(account.address, "pending"),
        "chainId": CHAIN_ID,
        "gas": 100000,
        "maxPriorityFeePerGas": priority_fee,
        "maxFeePerGas": base_fee * 2 + priority_fee,
    })
    signed = account.sign_transaction(transaction)
    tx_hash = web3.to_hex(web3.eth.send_raw_transaction(signed.raw_transaction))
    payment["tx_hash"] = tx_hash
    payment["status"] = PaymentStatus.SUBMITTED
    add_event(payment, PaymentStatus.SUBMITTED, {"tx_hash": tx_hash, "autonomous": True})
    return payment


@app.post("/payments/{payment_id}/verify")
def verify_payment(payment_id: str, request: TxRequest) -> dict[str, Any]:
    payment = get_payment(payment_id)
    if payment["status"] not in (PaymentStatus.SUBMITTED, PaymentStatus.AUTHORIZED):
        raise HTTPException(409, "Payment must be submitted before verification")
    try:
        verification = verify_transfer(payment, request.tx_hash)
    except Exception as exc:
        raise HTTPException(502, f"Could not query Arbitrum RPC: {exc}") from exc
    if not verification["verified"]:
        add_event(payment, "PAYMENT_FAILED", verification)
        raise HTTPException(422, {"message": "Payment does not match request", "verification": verification})
    payment["tx_hash"] = request.tx_hash
    payment["status"] = PaymentStatus.CONFIRMED
    add_event(payment, PaymentStatus.CONFIRMED, verification)
    return payment


@app.get("/payments/{payment_id}/events")
def payment_events(payment_id: str) -> list[dict[str, Any]]:
    return get_payment(payment_id)["events"]


def verify_transfer(payment: dict[str, Any], tx_hash: str) -> dict[str, Any]:
    """Verify the expected ARGt ERC-20 Transfer on Arbitrum."""
    if not web3.is_connected():
        raise RuntimeError("Arbitrum RPC is not reachable")
    receipt = web3.eth.get_transaction_receipt(tx_hash)
    confirmations = max(0, web3.eth.block_number - receipt["blockNumber"] + 1)
    expected = payment["data"]
    checks = {
        "chain": CHAIN_ID == 42161,
        "transaction_succeeded": receipt["status"] == 1,
        "confirmations": confirmations >= REQUIRED_CONFIRMATIONS,
        "token": False,
        "sender": False,
        "recipient": False,
        "amount": False,
    }
    token = web3.eth.contract(
        address=web3.to_checksum_address(ARGT_ADDRESS),
        abi=ERC20_ABI,
    )
    transfers = token.events.Transfer().process_receipt(receipt)
    for transfer in transfers:
        args = transfer["args"]
        checks["token"] = transfer["address"].lower() == ARGT_ADDRESS.lower()
        checks["sender"] = args["from"].lower() == expected["payer_wallet"].lower()
        checks["recipient"] = args["to"].lower() == expected["payee_wallet"].lower()
        checks["amount"] = int(args["value"]) == int(expected["amount_base_units"])
        if all(checks.values()):
            break
    return {
        "verified": all(checks.values()),
        "tx_hash": tx_hash,
        "block_number": receipt["blockNumber"],
        "confirmations": confirmations,
        "checks": checks,
    }
