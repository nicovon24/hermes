import "server-only";

import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  formatEther,
  http,
  parseAbi,
  type Address,
  type Hash,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum } from "viem/chains";

import { paymentEnv } from "@/lib/env";
import { ARGT_ADDRESS } from "@/modules/payments/domain";

export const argtAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
]);

export type ConfirmedTransfer = {
  hash: Hash;
  gasUsedWei: string;
  effectiveGasPriceWei: string;
  gasFeeWei: string;
  gasFeeEth: string;
};

export interface PaymentGateway {
  accountAddress(): Address;
  balanceOf(wallet: Address): Promise<bigint>;
  simulateTransfer(from: Address, to: Address, amount: bigint): Promise<void>;
  submitTransfer(to: Address, amount: bigint): Promise<Hash>;
  waitForTransfer(
    hash: Hash,
    expected: { from: Address; to: Address; amount: bigint; confirmations: number },
  ): Promise<ConfirmedTransfer>;
}

export class PaymentReceiptMismatchError extends Error {
  constructor() {
    super("Confirmed transaction does not match the requested ARGt transfer");
    this.name = "PaymentReceiptMismatchError";
  }
}

function verifyTransferReceipt(
  receipt: TransactionReceipt,
  expected: { from: Address; to: Address; amount: bigint },
) {
  if (receipt.status !== "success") return false;
  return receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== ARGT_ADDRESS.toLowerCase()) return false;
    try {
      const event = decodeEventLog({ abi: argtAbi, data: log.data, topics: log.topics });
      if (event.eventName !== "Transfer") return false;
      return (
        event.args.from.toLowerCase() === expected.from.toLowerCase() &&
        event.args.to.toLowerCase() === expected.to.toLowerCase() &&
        event.args.value === expected.amount
      );
    } catch {
      return false;
    }
  });
}

export class ViemPaymentGateway implements PaymentGateway {
  private readonly environment = paymentEnv();
  private readonly account = privateKeyToAccount(this.environment.privateKey);
  private readonly publicClient = createPublicClient({
    chain: arbitrum,
    transport: http(this.environment.rpcUrl),
  });
  private readonly walletClient = createWalletClient({
    account: this.account,
    chain: arbitrum,
    transport: http(this.environment.rpcUrl),
  });

  accountAddress() {
    return this.account.address;
  }

  balanceOf(wallet: Address) {
    return this.publicClient.readContract({
      address: ARGT_ADDRESS,
      abi: argtAbi,
      functionName: "balanceOf",
      args: [wallet],
    });
  }

  async simulateTransfer(from: Address, to: Address, amount: bigint) {
    await this.publicClient.simulateContract({
      account: from,
      address: ARGT_ADDRESS,
      abi: argtAbi,
      functionName: "transfer",
      args: [to, amount],
    });
  }

  submitTransfer(to: Address, amount: bigint) {
    return this.walletClient.writeContract({
      account: this.account,
      chain: arbitrum,
      address: ARGT_ADDRESS,
      abi: argtAbi,
      functionName: "transfer",
      args: [to, amount],
    });
  }

  async waitForTransfer(
    hash: Hash,
    expected: { from: Address; to: Address; amount: bigint; confirmations: number },
  ) {
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash,
      confirmations: expected.confirmations,
    });
    if (!verifyTransferReceipt(receipt, expected)) {
      throw new PaymentReceiptMismatchError();
    }
    const gasFee = receipt.gasUsed * receipt.effectiveGasPrice;
    return {
      hash,
      gasUsedWei: receipt.gasUsed.toString(),
      effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
      gasFeeWei: gasFee.toString(),
      gasFeeEth: formatEther(gasFee),
    };
  }
}
