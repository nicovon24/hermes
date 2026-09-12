import "server-only";

import { randomUUID } from "node:crypto";

import { PaymentStatus, Prisma, type Payment } from "@prisma/client";
import { getAddress, type Hash } from "viem";

import type { Actor } from "@/lib/demo-workspace";
import { DomainError } from "@/lib/domain/errors";
import { paymentEnv } from "@/lib/env";
import { prisma, serializableTransaction } from "@/lib/prisma";
import {
  ARBITRUM_CHAIN_ID,
  ARGT_ADDRESS,
  ARGT_SYMBOL,
  arsToDemoArgtBaseUnits,
  paymentAgentId,
  paymentEventHash,
  runSequentially,
} from "@/modules/payments/domain";
import {
  ViemPaymentGateway,
  PaymentReceiptMismatchError,
  type ConfirmedTransfer,
  type PaymentGateway,
} from "@/modules/payments/gateway";

export type PaymentOrder = {
  id: string;
  purchaseRequestId: string;
  buyerCompanyId: string;
  supplierCompanyId: string;
  externalReference: string;
  total: Prisma.Decimal;
  buyer: { legalName: string };
  supplier: { legalName: string };
};

async function appendPaymentEvent(
  tx: Prisma.TransactionClient,
  payment: Pick<
    Payment,
    "id" | "chainId" | "tokenAddress" | "tokenSymbol" | "amountBaseUnits"
  >,
  type: string,
  data: Prisma.InputJsonValue,
  gas?: Partial<ConfirmedTransfer>,
) {
  const previous = await tx.paymentEvent.findFirst({
    where: { paymentId: payment.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { hash: true },
  });
  const hash = paymentEventHash(payment.id, type, data, previous?.hash ?? null);
  await tx.paymentEvent.create({
    data: {
      paymentId: payment.id,
      type,
      data,
      previousHash: previous?.hash ?? null,
      hash,
      chainId: payment.chainId,
      tokenAddress: payment.tokenAddress,
      tokenSymbol: payment.tokenSymbol,
      amountBaseUnits: payment.amountBaseUnits,
      gasUsedWei: gas?.gasUsedWei,
      effectiveGasPriceWei: gas?.effectiveGasPriceWei,
      gasFeeWei: gas?.gasFeeWei,
      gasFeeEth: gas?.gasFeeEth,
    },
  });
}

async function recordProtocolPaymentStatus(
  tx: Prisma.TransactionClient,
  payment: Payment,
  order: PaymentOrder,
  status: "SUBMITTED" | "CONFIRMED" | "FAILED",
  transactionReference: string | null,
) {
  const negotiation = await tx.negotiation.findUnique({
    where: {
      purchaseRequestId_supplierCompanyId: {
        purchaseRequestId: order.purchaseRequestId,
        supplierCompanyId: order.supplierCompanyId,
      },
    },
    select: { id: true },
  });
  if (!negotiation) throw new Error("Payment negotiation not found");
  const idempotencyKey = `payment-status:${payment.id}:${status}`;
  const existing = await tx.negotiationMessage.findUnique({
    where: {
      senderCompanyId_idempotencyKey: {
        senderCompanyId: order.buyerCompanyId,
        idempotencyKey,
      },
    },
  });
  if (existing) return;

  const messageId = randomUUID();
  const sentAt = new Date();
  const payload = { paymentId: payment.id, status, transactionReference };
  const rawMessage = {
    messageId,
    protocolVersion: "1.0",
    type: "payment_status",
    senderCompanyId: order.buyerCompanyId,
    recipientCompanyId: order.supplierCompanyId,
    purchaseRequestId: order.purchaseRequestId,
    negotiationId: negotiation.id,
    correlationId: null,
    sentAt: sentAt.toISOString(),
    expiresAt: null,
    idempotencyKey,
    payload,
  };
  await tx.negotiationMessage.create({
    data: {
      id: messageId,
      negotiationId: negotiation.id,
      purchaseRequestId: order.purchaseRequestId,
      protocolVersion: "1.0",
      messageType: "payment_status",
      senderCompanyId: order.buyerCompanyId,
      recipientCompanyId: order.supplierCompanyId,
      sentAt,
      idempotencyKey,
      payload,
      rawMessage,
    },
  });
}

async function markRequestForReview(
  purchaseRequestId: string,
  actorId: string,
  reason: string,
) {
  await serializableTransaction(
    async (tx) => {
      await tx.$queryRaw`select id from public.purchase_requests where id = ${purchaseRequestId}::uuid for update`;
      const current = await tx.purchaseRequest.findUnique({
        where: { id: purchaseRequestId },
        select: { status: true },
      });
      if (current?.status === "PAYMENT_REVIEW_REQUIRED") return;
      await tx.purchaseRequest.update({
        where: { id: purchaseRequestId },
        data: { status: "PAYMENT_REVIEW_REQUIRED", version: { increment: 1 } },
      });
      await Promise.all([
        tx.domainEvent.create({
          data: {
            aggregateType: "purchase_request",
            aggregateId: purchaseRequestId,
            eventType: "payment.review_required",
            payload: { purchaseRequestId, reason },
          },
        }),
        tx.auditLog.create({
          data: {
            actorType: "AGENT",
            actorId,
            action: "payment.review_required",
            aggregateType: "purchase_request",
            aggregateId: purchaseRequestId,
            metadata: { reason },
          },
        }),
      ]);
    },
  );
}

async function loadPaymentPlan(purchaseRequestId: string) {
  const request = await prisma.purchaseRequest.findUnique({
    where: { id: purchaseRequestId },
    include: {
      mandates: { where: { status: { in: ["ACTIVE", "CONSUMED"] } }, orderBy: { version: "desc" }, take: 1 },
      items: { select: { status: true } },
      purchaseOrders: {
        include: {
          buyer: { select: { legalName: true } },
          supplier: { select: { legalName: true } },
          payment: true,
        },
        orderBy: [{ externalReference: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!request) throw new DomainError("Purchase request not found", "NOT_FOUND", 404);
  const mandate = request.mandates[0];
  if (!mandate?.autoPay) return null;
  if (
    mandate.expiresAt <= new Date() ||
    mandate.paymentTerms !== "CONTADO" ||
    mandate.settlementAsset !== "ARGt"
  ) {
    throw new DomainError("Automatic payment mandate is invalid or expired", "CONFLICT", 409);
  }
  const aggregate = request.purchaseOrders.reduce(
    (sum, order) => sum.plus(order.total),
    new Prisma.Decimal(0),
  );
  if (aggregate.greaterThan(mandate.maximumTotalIncludingFees)) {
    throw new DomainError("Aggregate order total exceeds the mandate", "CONFLICT", 409);
  }
  return { request, mandate, orders: request.purchaseOrders as PaymentOrder[] };
}

function assertWalletsAndAmounts(orders: PaymentOrder[]) {
  const environment = paymentEnv();
  const prepared = orders.map((order) => {
    const payerWallet = environment.wallets[order.buyerCompanyId];
    const payeeWallet = environment.wallets[order.supplierCompanyId];
    if (!payerWallet || !payeeWallet) {
      throw new DomainError(
        `Missing payment wallet for order ${order.externalReference}`,
        "CONFLICT",
        409,
      );
    }
    const amount = arsToDemoArgtBaseUnits(order.total.toFixed(2));
    if (amount <= 0n || amount > environment.maxPaymentBaseUnits) {
      throw new DomainError(
        `Payment limit exceeded for order ${order.externalReference}`,
        "CONFLICT",
        409,
      );
    }
    return { order, payerWallet, payeeWallet, amount };
  });
  return { environment, prepared };
}

export async function preflightPayments(
  orders: PaymentOrder[],
  gateway: PaymentGateway,
) {
  const { environment, prepared } = assertWalletsAndAmounts(orders);
  const payerWallet = prepared[0]?.payerWallet;
  if (!payerWallet) return prepared;
  if (getAddress(gateway.accountAddress()) !== getAddress(payerWallet)) {
    throw new DomainError(
      "AGENT_PRIVATE_KEY does not match the configured buyer wallet",
      "CONFLICT",
      409,
    );
  }
  const required = prepared.reduce((sum, item) => sum + item.amount, 0n);
  const balance = await gateway.balanceOf(payerWallet);
  if (balance < required) {
    throw new DomainError("Insufficient aggregate ARGt balance", "CONFLICT", 409);
  }
  for (const item of prepared) {
    await gateway.simulateTransfer(item.payerWallet, item.payeeWallet, item.amount);
  }
  void environment;
  return prepared;
}

async function createPaymentIntents(
  prepared: Awaited<ReturnType<typeof preflightPayments>>,
  route: "ARBITRUM_DIRECT" | "SOLANA_TO_ARBITRUM" = "ARBITRUM_DIRECT",
) {
  return serializableTransaction(
    async (tx) => {
      const result: Array<{ payment: Payment; order: PaymentOrder }> = [];
      const newlyAuthorizedIds: string[] = [];
      for (const item of prepared) {
        const { order, payerWallet, payeeWallet, amount } = item;
        await tx.agent.upsert({
          where: { id: paymentAgentId(order.buyerCompanyId) },
          create: {
            id: paymentAgentId(order.buyerCompanyId),
            organization: order.buyer.legalName,
            role: "BUYER",
            wallet: payerWallet,
          },
          update: { organization: order.buyer.legalName, role: "BUYER", wallet: payerWallet },
        });
        await tx.agent.upsert({
          where: { id: paymentAgentId(order.supplierCompanyId) },
          create: {
            id: paymentAgentId(order.supplierCompanyId),
            organization: order.supplier.legalName,
            role: "SUPPLIER",
            wallet: payeeWallet,
          },
          update: { organization: order.supplier.legalName, role: "SUPPLIER", wallet: payeeWallet },
        });
        let payment = await tx.payment.upsert({
          where: { purchaseOrderId: order.id },
          create: {
              conversationId: order.purchaseRequestId,
              purchaseOrderId: order.id,
              payerAgentId: paymentAgentId(order.buyerCompanyId),
              payeeAgentId: paymentAgentId(order.supplierCompanyId),
              payerWallet,
              payeeWallet,
              chainId: ARBITRUM_CHAIN_ID,
              tokenAddress: ARGT_ADDRESS,
              tokenSymbol: ARGT_SYMBOL,
              amountBaseUnits: amount.toString(),
              route,
              externalReference: `payment:${order.externalReference}`,
          },
          update: { route },
        });
        const requestedEvent = await tx.paymentEvent.findFirst({
          where: { paymentId: payment.id, type: "PAYMENT_REQUESTED" },
        });
        if (payment.status === PaymentStatus.PAYMENT_REQUESTED) {
          if (!requestedEvent) {
            await appendPaymentEvent(tx, payment, "PAYMENT_REQUESTED", {
              purchaseOrderId: order.id,
              externalReference: payment.externalReference,
            });
          }
          payment = await tx.payment.update({
            where: { id: payment.id },
            data: { status: PaymentStatus.PAYMENT_AUTHORIZED },
          });
          newlyAuthorizedIds.push(payment.id);
          await appendPaymentEvent(tx, payment, "PAYMENT_AUTHORIZED", {
            purchaseOrderId: order.id,
          });
        }
        result.push({ payment, order });
      }
      if (newlyAuthorizedIds.length) {
        const pendingItems = await tx.purchaseRequestItem.count({
          where: { purchaseRequestId: result[0].order.purchaseRequestId, status: "PENDING" },
        });
        if (pendingItems === 0) {
          await tx.purchaseRequest.updateMany({
            where: {
              id: result[0].order.purchaseRequestId,
              status: "ORDER_CREATED",
            },
            data: { status: "PAYMENT_PENDING", version: { increment: 1 } },
          });
        }
        await tx.domainEvent.create({
          data: {
            aggregateType: "purchase_request",
            aggregateId: result[0].order.purchaseRequestId,
            eventType: "payment.authorized",
            payload: { paymentIds: newlyAuthorizedIds },
          },
        });
      }
      return result;
    },
  );
}

async function confirmPayment(
  payment: Payment,
  order: PaymentOrder,
  confirmation: ConfirmedTransfer,
) {
  return serializableTransaction(
    async (tx) => {
      await tx.$queryRaw`select id from public.payments where id = ${payment.id} for update`;
      const current = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
      if (current.status === PaymentStatus.PAYMENT_CONFIRMED) return current;
      if (current.status !== PaymentStatus.PAYMENT_SUBMITTED) {
        throw new DomainError("Only a submitted payment can be confirmed", "CONFLICT", 409);
      }
      const updated = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.PAYMENT_CONFIRMED,
          txHash: confirmation.hash,
          confirmedAt: new Date(),
          lastError: null,
          gasUsedWei: confirmation.gasUsedWei,
          effectiveGasPriceWei: confirmation.effectiveGasPriceWei,
          gasFeeWei: confirmation.gasFeeWei,
          gasFeeEth: confirmation.gasFeeEth,
        },
      });
      await appendPaymentEvent(
        tx,
        updated,
        "PAYMENT_CONFIRMED",
        { txHash: confirmation.hash, verified: true },
        confirmation,
      );
      await recordProtocolPaymentStatus(tx, updated, order, "CONFIRMED", confirmation.hash);
      await Promise.all([
        tx.domainEvent.create({
          data: {
            aggregateType: "purchase_order",
            aggregateId: order.id,
            eventType: "payment.confirmed",
            payload: { paymentId: updated.id, txHash: confirmation.hash },
          },
        }),
        tx.auditLog.create({
          data: {
            companyId: order.buyerCompanyId,
            actorType: "AGENT",
            actorId: paymentAgentId(order.buyerCompanyId),
            action: "payment.confirmed",
            aggregateType: "purchase_order",
            aggregateId: order.id,
            metadata: { paymentId: updated.id, txHash: confirmation.hash },
          },
        }),
      ]);
      return updated;
    },
  );
}

async function failSubmittedPayment(
  payment: Payment,
  order: PaymentOrder,
  message: string,
  txHash: string,
) {
  return serializableTransaction(async (tx) => {
    await tx.$queryRaw`select id from public.payments where id = ${payment.id} for update`;
    const current = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
    if (
      current.status === PaymentStatus.PAYMENT_FAILED ||
      current.status === PaymentStatus.PAYMENT_CONFIRMED
    ) return current;
    if (current.status !== PaymentStatus.PAYMENT_SUBMITTED) {
      throw new DomainError("Only a submitted payment can fail reconciliation", "CONFLICT", 409);
    }
    const failed = await tx.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.PAYMENT_FAILED, lastError: message },
    });
    await appendPaymentEvent(tx, failed, "PAYMENT_FAILED", { error: message, txHash });
    await recordProtocolPaymentStatus(tx, failed, order, "FAILED", txHash);
    return failed;
  });
}

async function executePayment(
  payment: Payment,
  order: PaymentOrder,
  gateway: PaymentGateway,
  confirmations: number,
  onProgress: () => Promise<void> = async () => {},
) {
  const payee = getAddress(payment.payeeWallet);
  const payer = getAddress(payment.payerWallet);
  const amount = BigInt(payment.amountBaseUnits);
  const claim = await prisma.payment.updateMany({
    where: {
      id: payment.id,
      status: PaymentStatus.PAYMENT_AUTHORIZED,
      lastError: null,
    },
    data: {
      attemptCount: { increment: 1 },
      lastError: "SUBMISSION_IN_PROGRESS",
    },
  });
  if (claim.count !== 1) {
    throw new DomainError("Payment is already being submitted", "CONFLICT", 409);
  }

  let hash: Hash;
  try {
    hash = await gateway.submitTransfer(payee, amount);
  } catch (error) {
    const message = error instanceof Error ? error.message : "ARGt transfer failed";
    await serializableTransaction(async (tx) => {
      const failed = await tx.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.PAYMENT_FAILED, lastError: message },
      });
      await appendPaymentEvent(tx, failed, "PAYMENT_FAILED", { error: message });
      await recordProtocolPaymentStatus(tx, failed, order, "FAILED", null);
    });
    await onProgress();
    throw new DomainError(message, "CONFLICT", 409);
  }

  const submitted = await serializableTransaction(async (tx) => {
    const updated = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.PAYMENT_SUBMITTED,
        txHash: hash,
        submittedAt: new Date(),
        lastError: null,
      },
    });
    await appendPaymentEvent(tx, updated, "PAYMENT_SUBMITTED", { txHash: hash });
    await recordProtocolPaymentStatus(tx, updated, order, "SUBMITTED", hash);
    return updated;
  });
  await onProgress();

  try {
    const confirmation = await gateway.waitForTransfer(hash, {
      from: payer,
      to: payee,
      amount,
      confirmations,
    });
    const confirmed = await confirmPayment(submitted, order, confirmation);
    await onProgress();
    return confirmed;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Confirmation timed out";
    if (error instanceof PaymentReceiptMismatchError) {
      await failSubmittedPayment(submitted, order, message, hash);
    } else {
      await prisma.payment.update({ where: { id: submitted.id }, data: { lastError: message } });
    }
    await onProgress();
    throw new DomainError(
      `Transfer submitted but not reconciled: ${message}`,
      "CONFLICT",
      409,
    );
  }
}

async function finishPaymentState(purchaseRequestId: string) {
  const request = await prisma.purchaseRequest.findUniqueOrThrow({
    where: { id: purchaseRequestId },
    include: { items: { select: { status: true } }, purchaseOrders: { include: { payment: true } } },
  });
  const allConfirmed = request.purchaseOrders.every(
    ({ payment }) => payment?.status === PaymentStatus.PAYMENT_CONFIRMED,
  );
  if (!allConfirmed) return;
  const hasPendingItems = request.items.some(({ status }) => status === "PENDING");
  const targetStatus = hasPendingItems ? "PARTIALLY_ORDERED" : "PAYMENT_CONFIRMED";
  await prisma.purchaseRequest.updateMany({
    where: { id: request.id, status: { not: targetStatus } },
    data: {
      status: targetStatus,
      version: { increment: 1 },
    },
  });
}

export async function runAutomaticPaymentsForPurchaseRequest(
  actor: Actor,
  purchaseRequestId: string,
  providedGateway?: PaymentGateway,
  observer?: () => Promise<void>,
  route: "ARBITRUM_DIRECT" | "SOLANA_TO_ARBITRUM" = "ARBITRUM_DIRECT",
) {
  const onProgress = async () => { try { await observer?.(); } catch (error) { console.error("Payment progress observer failed", error); } };
  const plan = await loadPaymentPlan(purchaseRequestId);
  if (!plan) return { attempted: 0, confirmed: 0, skipped: true, error: null };
  if (plan.request.buyerCompanyId !== actor.companyId) {
    throw new DomainError("Only the buyer can execute payments", "FORBIDDEN", 403);
  }

  let prepared: Awaited<ReturnType<typeof preflightPayments>>;
  let gateway: PaymentGateway;
  let confirmations: number;
  try {
    gateway = providedGateway ?? new ViemPaymentGateway();
    confirmations = paymentEnv().requiredConfirmations;
    const unpaidOrders = plan.request.purchaseOrders
      .filter(({ payment }) => payment?.status !== PaymentStatus.PAYMENT_CONFIRMED)
      .map((order) => order as PaymentOrder);
    prepared = await preflightPayments(unpaidOrders, gateway);
  } catch (error) {
    await markRequestForReview(
      purchaseRequestId,
      actor.actorId,
      error instanceof Error ? error.message : "Payment preflight failed",
    );
    throw error;
  }
  const intents = await createPaymentIntents(prepared, route);
  await onProgress();
  const sequence = await runSequentially(intents, async ({ payment, order }) => {
    if (payment.status === PaymentStatus.PAYMENT_CONFIRMED) {
      return;
    }
    if (payment.status !== PaymentStatus.PAYMENT_AUTHORIZED) {
      throw new DomainError(`Payment ${payment.id} requires manual reconciliation`, "CONFLICT", 409);
    }
    if (payment.route === "SOLANA_TO_ARBITRUM") return;
    await executePayment(payment, order, gateway, confirmations, onProgress);
  });
  if (sequence.failedIndex !== null) {
    const message = sequence.error instanceof Error
      ? sequence.error.message
      : "Automatic payment failed";
    await markRequestForReview(
      purchaseRequestId,
      actor.actorId,
      message,
    );
    return {
      attempted: intents.length,
      confirmed: sequence.completed,
      skipped: false,
      error: message,
    };
  }
  await finishPaymentState(purchaseRequestId);
  return { attempted: intents.length, confirmed: sequence.completed, skipped: false, error: null };
}

export async function payPurchaseOrder(
  actor: Actor,
  purchaseOrderId: string,
  providedGateway?: PaymentGateway,
) {
  const order = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: {
      buyer: { select: { legalName: true } },
      supplier: { select: { legalName: true } },
      payment: true,
    },
  });
  if (!order || order.buyerCompanyId !== actor.companyId) {
    throw new DomainError("Purchase order not found", "NOT_FOUND", 404);
  }
  if (order.payment?.status === PaymentStatus.PAYMENT_CONFIRMED) {
    return order.payment;
  }
  if (order.payment && order.payment.status !== PaymentStatus.PAYMENT_AUTHORIZED) {
    throw new DomainError(
      "Este pago requiere conciliación antes de poder reintentarlo",
      "CONFLICT",
      409,
    );
  }

  const gateway = providedGateway ?? new ViemPaymentGateway();
  const confirmations = paymentEnv().requiredConfirmations;
  const paymentOrder = order as PaymentOrder;
  const prepared = await preflightPayments([paymentOrder], gateway);
  const [{ payment }] = await createPaymentIntents(prepared);
  const confirmed = await executePayment(payment, paymentOrder, gateway, confirmations);
  await finishPaymentState(order.purchaseRequestId);
  return confirmed;
}

export async function reviewAutomaticPayments(
  actor: Actor,
  purchaseRequestId: string,
  retryPaymentId: string | null,
  providedGateway?: PaymentGateway,
) {
  const plan = await loadPaymentPlan(purchaseRequestId);
  if (!plan || plan.request.buyerCompanyId !== actor.companyId) {
    throw new DomainError("Automatic payment request not found", "NOT_FOUND", 404);
  }
  const gateway = providedGateway ?? new ViemPaymentGateway();
  const confirmations = paymentEnv().requiredConfirmations;
  const existingPayments = await prisma.payment.findMany({
    where: { purchaseOrderId: { in: plan.orders.map(({ id }) => id) } },
  });
  const paymentByOrder = new Map(existingPayments.map((payment) => [payment.purchaseOrderId, payment]));

  // Reconciliation is deliberately first and never submits a transaction.
  for (const order of plan.orders) {
    const payment = paymentByOrder.get(order.id);
    if (payment?.status !== PaymentStatus.PAYMENT_SUBMITTED || !payment.txHash) continue;
    try {
      const confirmation = await gateway.waitForTransfer(payment.txHash as Hash, {
        from: getAddress(payment.payerWallet),
        to: getAddress(payment.payeeWallet),
        amount: BigInt(payment.amountBaseUnits),
        confirmations,
      });
      await confirmPayment(payment, order, confirmation);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Reconciliation failed";
      if (error instanceof PaymentReceiptMismatchError) {
        await failSubmittedPayment(payment, order, message, payment.txHash);
      } else {
        await prisma.payment.updateMany({
          where: { id: payment.id, status: PaymentStatus.PAYMENT_SUBMITTED },
          data: { lastError: message },
        });
      }
    }
  }

  if (!retryPaymentId) {
    await finishPaymentState(purchaseRequestId);
    return;
  }

  const refreshedPayments = await prisma.payment.findMany({
    where: { purchaseOrderId: { in: plan.orders.map(({ id }) => id) } },
  });
  const refreshedByOrder = new Map(
    refreshedPayments.map((payment) => [payment.purchaseOrderId, payment]),
  );
  const firstUnconfirmedIndex = plan.orders.findIndex(
    (order) => refreshedByOrder.get(order.id)?.status !== PaymentStatus.PAYMENT_CONFIRMED,
  );
  const firstUnconfirmed = firstUnconfirmedIndex >= 0
    ? refreshedByOrder.get(plan.orders[firstUnconfirmedIndex].id)
    : null;
  if (
    !firstUnconfirmed ||
    firstUnconfirmed.id !== retryPaymentId ||
    firstUnconfirmed.status !== PaymentStatus.PAYMENT_FAILED
  ) {
    throw new DomainError(
      "Only the first failed payment can be retried after submitted hashes are reconciled",
      "CONFLICT",
      409,
    );
  }

  const remainingOrders = plan.orders.slice(firstUnconfirmedIndex);
  const ordersToPreflight = remainingOrders.filter((order, index) => {
    const payment = refreshedByOrder.get(order.id);
    if (!payment) {
      throw new DomainError("Payment intent missing; automatic retry is not allowed", "CONFLICT", 409);
    }
    return (
      (index === 0 && payment.status === PaymentStatus.PAYMENT_FAILED) ||
      payment.status === PaymentStatus.PAYMENT_AUTHORIZED
    );
  });
  await preflightPayments(ordersToPreflight, gateway);

  for (const order of remainingOrders) {
    let payment = await prisma.payment.findUniqueOrThrow({
      where: { purchaseOrderId: order.id },
    });
    if (payment.status === PaymentStatus.PAYMENT_CONFIRMED) continue;
    if (payment.status === PaymentStatus.PAYMENT_SUBMITTED) break;
    if (payment.status === PaymentStatus.PAYMENT_FAILED && payment.id === retryPaymentId) {
      const claim = await prisma.payment.updateMany({
        where: { id: payment.id, status: PaymentStatus.PAYMENT_FAILED },
        data: { status: PaymentStatus.PAYMENT_AUTHORIZED, txHash: null, lastError: null },
      });
      if (claim.count !== 1) {
        throw new DomainError("Payment retry was already claimed", "CONFLICT", 409);
      }
      payment = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    }
    if (payment.status === PaymentStatus.PAYMENT_AUTHORIZED) {
      try {
        await executePayment(payment, order, gateway, confirmations);
      } catch {
        break;
      }
      continue;
    }
    break;
  }
  await finishPaymentState(purchaseRequestId);
}
