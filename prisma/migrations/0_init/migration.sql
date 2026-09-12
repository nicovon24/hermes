CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('PAYMENT_REQUESTED', 'PAYMENT_AUTHORIZED', 'PAYMENT_SUBMITTED', 'PAYMENT_CONFIRMED', 'PAYMENT_FAILED');

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "purchase_request_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input_snapshot" JSONB NOT NULL,
    "output" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "organization" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "wallet" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_credentials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "last_used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "company_id" UUID,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_objectives" (
    "company_id" UUID NOT NULL,
    "target_stock_capital" DECIMAL(20,2),
    "target_days_of_stock" INTEGER,
    "target_margin_percentage" DECIMAL(8,3),
    "target_rotation_days" INTEGER,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_objectives_pkey" PRIMARY KEY ("company_id")
);

-- CreateTable
CREATE TABLE "company_profiles" (
    "company_id" UUID NOT NULL,
    "tax_id" TEXT NOT NULL,
    "address_line" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "contact_name" TEXT NOT NULL,
    "contact_email" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "delivery_area" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_profiles_pkey" PRIMARY KEY ("company_id")
);

-- CreateTable
CREATE TABLE "context_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "context_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "context_sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "last_version" TEXT NOT NULL,
    "last_observed_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "context_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domain_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "domain_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "source_version" TEXT NOT NULL,
    "on_hand" DECIMAL(24,6) NOT NULL,
    "reserved" DECIMAL(24,6) NOT NULL,
    "in_transit" DECIMAL(24,6) NOT NULL,
    "observed_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mandates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purchase_request_id" UUID NOT NULL,
    "buyer_company_id" UUID NOT NULL,
    "approved_by" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "maximum_total_including_fees" DECIMAL(20,2) NOT NULL,
    "allowed_suppliers" UUID[],
    "payment_terms" TEXT NOT NULL,
    "settlement_asset" TEXT NOT NULL,
    "auto_accept" BOOLEAN NOT NULL DEFAULT false,
    "auto_pay" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "approved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mandates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "negotiation_messages" (
    "id" UUID NOT NULL,
    "negotiation_id" UUID NOT NULL,
    "purchase_request_id" UUID NOT NULL,
    "protocol_version" TEXT NOT NULL,
    "message_type" TEXT NOT NULL,
    "sender_company_id" UUID NOT NULL,
    "recipient_company_id" UUID NOT NULL,
    "correlation_id" UUID,
    "sent_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6),
    "idempotency_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "raw_message" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tender_round_id" UUID,

    CONSTRAINT "negotiation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "negotiation_metrics" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "negotiation_id" UUID NOT NULL,
    "purchase_request_id" UUID NOT NULL,
    "supplier_company_id" UUID NOT NULL,
    "rounds" INTEGER NOT NULL,
    "message_count" INTEGER NOT NULL,
    "initial_total" DECIMAL(20,2) NOT NULL,
    "final_total" DECIMAL(20,2) NOT NULL,
    "price_reduction_percentage" DECIMAL(8,3) NOT NULL,
    "estimated_margin_percentage" DECIMAL(8,3) NOT NULL,
    "capital_efficiency_score" DECIMAL(8,3) NOT NULL,
    "stock_available" DECIMAL(24,6) NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "negotiation_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "negotiations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purchase_request_id" UUID NOT NULL,
    "buyer_company_id" UUID NOT NULL,
    "supplier_company_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "negotiations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "offer_id" UUID NOT NULL,
    "purchase_request_id" UUID NOT NULL,
    "request_item_id" UUID NOT NULL,
    "product_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(24,6) NOT NULL,
    "unit_price" DECIMAL(20,2) NOT NULL,
    "subtotal" DECIMAL(20,2) NOT NULL,
    "taxes" DECIMAL(20,2) NOT NULL,
    "shipping" DECIMAL(20,2) NOT NULL,
    "total" DECIMAL(20,2) NOT NULL,
    "confirmed_stock" BOOLEAN NOT NULL,
    "delivery_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offer_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" UUID NOT NULL,
    "negotiation_id" UUID NOT NULL,
    "purchase_request_id" UUID NOT NULL,
    "supplier_company_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "currency" TEXT NOT NULL,
    "valid_until" TIMESTAMPTZ(6) NOT NULL,
    "subtotal" DECIMAL(20,2) NOT NULL,
    "taxes" DECIMAL(20,2) NOT NULL,
    "shipping" DECIMAL(20,2) NOT NULL,
    "discount" DECIMAL(20,2) NOT NULL,
    "total" DECIMAL(20,2) NOT NULL,
    "delivery_date" DATE NOT NULL,
    "payment_terms" TEXT NOT NULL,
    "confirmed_stock" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tender_round_id" UUID,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "previous_hash" TEXT,
    "hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gas_used_wei" TEXT,
    "effective_gas_price_wei" TEXT,
    "gas_fee_wei" TEXT,
    "gas_fee_eth" TEXT,
    "chain_id" INTEGER,
    "token_address" TEXT,
    "amount_base_units" TEXT,
    "token_symbol" TEXT,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "payer_agent_id" TEXT NOT NULL,
    "payee_agent_id" TEXT NOT NULL,
    "payer_wallet" TEXT NOT NULL,
    "payee_wallet" TEXT NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "token_address" TEXT NOT NULL,
    "amount_base_units" TEXT NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'PAYMENT_REQUESTED',
    "txHash" TEXT,
    "external_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "gas_used_wei" TEXT,
    "effective_gas_price_wei" TEXT,
    "gas_fee_wei" TEXT,
    "gas_fee_eth" TEXT,
    "token_symbol" TEXT NOT NULL DEFAULT 'ARGt',

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unit_cost" DECIMAL(20,2) NOT NULL DEFAULT 0,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purchase_order_id" UUID NOT NULL,
    "request_item_id" UUID NOT NULL,
    "offer_line_id" UUID NOT NULL,
    "product_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(24,6) NOT NULL,
    "unit_price" DECIMAL(20,2) NOT NULL,
    "subtotal" DECIMAL(20,2) NOT NULL,
    "taxes" DECIMAL(20,2) NOT NULL,
    "shipping" DECIMAL(20,2) NOT NULL,
    "total" DECIMAL(20,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purchase_request_id" UUID NOT NULL,
    "tender_round_id" UUID NOT NULL,
    "buyer_company_id" UUID NOT NULL,
    "supplier_company_id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "subtotal" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "taxes" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "shipping" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "delivery_date" DATE NOT NULL,
    "payment_terms" TEXT NOT NULL,
    "external_reference" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_request_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purchase_request_id" UUID NOT NULL,
    "product_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "minimum_quantity" DECIMAL(24,6) NOT NULL,
    "target_quantity" DECIMAL(24,6) NOT NULL,
    "maximum_quantity" DECIMAL(24,6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "pending_reason" TEXT,
    "urgency_score" DECIMAL(20,6) NOT NULL DEFAULT 999999,
    "awarded_at" TIMESTAMPTZ(6),

    CONSTRAINT "purchase_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buyer_company_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AWAITING_APPROVAL',
    "currency" TEXT NOT NULL,
    "required_by" DATE NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "external_event_id" TEXT NOT NULL,
    "source_version" TEXT NOT NULL,
    "quantity" DECIMAL(24,6) NOT NULL,
    "unit_price" DECIMAL(20,2) NOT NULL,
    "sold_at" TIMESTAMPTZ(6) NOT NULL,
    "observed_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customer_company_id" UUID,

    CONSTRAINT "sales_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tender_rounds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purchase_request_id" UUID NOT NULL,
    "round_number" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "request_item_ids" UUID[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "tender_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_credentials_secret_hash_key" ON "api_credentials"("secret_hash");

-- CreateIndex
CREATE UNIQUE INDEX "companies_slug_key" ON "companies"("slug");

-- CreateIndex
CREATE INDEX "context_events_company_idx" ON "context_events"("company_id", "occurred_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "context_sources_company_id_external_id_key" ON "context_sources"("company_id", "external_id");

-- CreateIndex
CREATE INDEX "domain_events_aggregate_idx" ON "domain_events"("aggregate_type", "aggregate_id", "occurred_at");

-- CreateIndex
CREATE INDEX "inventory_company_observed_idx" ON "inventory_snapshots"("company_id", "observed_at" DESC);

-- CreateIndex
CREATE INDEX "inventory_product_observed_idx" ON "inventory_snapshots"("product_id", "observed_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_snapshots_source_id_product_id_source_version_key" ON "inventory_snapshots"("source_id", "product_id", "source_version");

-- CreateIndex
CREATE UNIQUE INDEX "mandates_purchase_request_id_version_key" ON "mandates"("purchase_request_id", "version");

-- CreateIndex
CREATE INDEX "messages_negotiation_sent_idx" ON "negotiation_messages"("negotiation_id", "sent_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "negotiation_messages_sender_company_id_idempotency_key_key" ON "negotiation_messages"("sender_company_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "negotiation_metrics_negotiation_id_key" ON "negotiation_metrics"("negotiation_id");

-- CreateIndex
CREATE INDEX "negotiation_metrics_request_idx" ON "negotiation_metrics"("purchase_request_id", "recorded_at" DESC);

-- CreateIndex
CREATE INDEX "negotiations_request_idx" ON "negotiations"("purchase_request_id");

-- CreateIndex
CREATE INDEX "negotiations_supplier_idx" ON "negotiations"("supplier_company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "negotiations_purchase_request_id_supplier_company_id_key" ON "negotiations"("purchase_request_id", "supplier_company_id");

-- CreateIndex
CREATE INDEX "offer_lines_request_idx" ON "offer_lines"("purchase_request_id", "request_item_id", "total");

-- CreateIndex
CREATE UNIQUE INDEX "offer_lines_offer_id_request_item_id_key" ON "offer_lines"("offer_id", "request_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "offers_message_id_key" ON "offers"("message_id");

-- CreateIndex
CREATE INDEX "offers_request_active_idx" ON "offers"("purchase_request_id", "status", "valid_until");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_txHash_key" ON "payments"("txHash");

-- CreateIndex
CREATE UNIQUE INDEX "products_company_id_external_id_key" ON "products"("company_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_items_request_item_id_key" ON "purchase_order_items"("request_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_items_offer_line_id_key" ON "purchase_order_items"("offer_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_external_reference_key" ON "purchase_orders"("external_reference");

-- CreateIndex
CREATE INDEX "purchase_orders_buyer_idx" ON "purchase_orders"("buyer_company_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "purchase_orders_supplier_idx" ON "purchase_orders"("supplier_company_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_tender_round_id_supplier_company_id_key" ON "purchase_orders"("tender_round_id", "supplier_company_id");

-- CreateIndex
CREATE INDEX "purchase_requests_buyer_status_idx" ON "purchase_requests"("buyer_company_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "sales_company_customer_sold_idx" ON "sales_events"("company_id", "customer_company_id", "sold_at" DESC);

-- CreateIndex
CREATE INDEX "sales_company_sold_idx" ON "sales_events"("company_id", "sold_at" DESC);

-- CreateIndex
CREATE INDEX "sales_product_sold_idx" ON "sales_events"("product_id", "sold_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "sales_events_source_id_external_event_id_key" ON "sales_events"("source_id", "external_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "tender_rounds_purchase_request_id_round_number_key" ON "tender_rounds"("purchase_request_id", "round_number");

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_purchase_request_id_fkey" FOREIGN KEY ("purchase_request_id") REFERENCES "purchase_requests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "api_credentials" ADD CONSTRAINT "api_credentials_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "company_objectives" ADD CONSTRAINT "company_objectives_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "company_profiles" ADD CONSTRAINT "company_profiles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "context_events" ADD CONSTRAINT "context_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "context_events" ADD CONSTRAINT "context_events_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "context_sources"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "context_sources" ADD CONSTRAINT "context_sources_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory_snapshots" ADD CONSTRAINT "inventory_snapshots_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory_snapshots" ADD CONSTRAINT "inventory_snapshots_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory_snapshots" ADD CONSTRAINT "inventory_snapshots_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "context_sources"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_buyer_company_id_fkey" FOREIGN KEY ("buyer_company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_purchase_request_id_fkey" FOREIGN KEY ("purchase_request_id") REFERENCES "purchase_requests"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "negotiation_messages" ADD CONSTRAINT "negotiation_messages_negotiation_id_fkey" FOREIGN KEY ("negotiation_id") REFERENCES "negotiations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "negotiation_messages" ADD CONSTRAINT "negotiation_messages_purchase_request_id_fkey" FOREIGN KEY ("purchase_request_id") REFERENCES "purchase_requests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "negotiation_messages" ADD CONSTRAINT "negotiation_messages_recipient_company_id_fkey" FOREIGN KEY ("recipient_company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "negotiation_messages" ADD CONSTRAINT "negotiation_messages_sender_company_id_fkey" FOREIGN KEY ("sender_company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "negotiation_messages" ADD CONSTRAINT "negotiation_messages_tender_round_id_fkey" FOREIGN KEY ("tender_round_id") REFERENCES "tender_rounds"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "negotiation_metrics" ADD CONSTRAINT "negotiation_metrics_negotiation_id_fkey" FOREIGN KEY ("negotiation_id") REFERENCES "negotiations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "negotiation_metrics" ADD CONSTRAINT "negotiation_metrics_purchase_request_id_fkey" FOREIGN KEY ("purchase_request_id") REFERENCES "purchase_requests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "negotiation_metrics" ADD CONSTRAINT "negotiation_metrics_supplier_company_id_fkey" FOREIGN KEY ("supplier_company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "negotiations" ADD CONSTRAINT "negotiations_buyer_company_id_fkey" FOREIGN KEY ("buyer_company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "negotiations" ADD CONSTRAINT "negotiations_purchase_request_id_fkey" FOREIGN KEY ("purchase_request_id") REFERENCES "purchase_requests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "negotiations" ADD CONSTRAINT "negotiations_supplier_company_id_fkey" FOREIGN KEY ("supplier_company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "offer_lines" ADD CONSTRAINT "offer_lines_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "offer_lines" ADD CONSTRAINT "offer_lines_purchase_request_id_fkey" FOREIGN KEY ("purchase_request_id") REFERENCES "purchase_requests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "offer_lines" ADD CONSTRAINT "offer_lines_request_item_id_fkey" FOREIGN KEY ("request_item_id") REFERENCES "purchase_request_items"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "negotiation_messages"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_negotiation_id_fkey" FOREIGN KEY ("negotiation_id") REFERENCES "negotiations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_purchase_request_id_fkey" FOREIGN KEY ("purchase_request_id") REFERENCES "purchase_requests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_supplier_company_id_fkey" FOREIGN KEY ("supplier_company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_tender_round_id_fkey" FOREIGN KEY ("tender_round_id") REFERENCES "tender_rounds"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "PaymentEvent_paymentId_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "Payment_payeeAgentId_fkey" FOREIGN KEY ("payee_agent_id") REFERENCES "agents"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "Payment_payerAgentId_fkey" FOREIGN KEY ("payer_agent_id") REFERENCES "agents"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_offer_line_id_fkey" FOREIGN KEY ("offer_line_id") REFERENCES "offer_lines"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_request_item_id_fkey" FOREIGN KEY ("request_item_id") REFERENCES "purchase_request_items"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_buyer_company_id_fkey" FOREIGN KEY ("buyer_company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_purchase_request_id_fkey" FOREIGN KEY ("purchase_request_id") REFERENCES "purchase_requests"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_company_id_fkey" FOREIGN KEY ("supplier_company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tender_round_id_fkey" FOREIGN KEY ("tender_round_id") REFERENCES "tender_rounds"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_purchase_request_id_fkey" FOREIGN KEY ("purchase_request_id") REFERENCES "purchase_requests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_buyer_company_id_fkey" FOREIGN KEY ("buyer_company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sales_events" ADD CONSTRAINT "sales_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sales_events" ADD CONSTRAINT "sales_events_customer_company_id_fkey" FOREIGN KEY ("customer_company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sales_events" ADD CONSTRAINT "sales_events_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sales_events" ADD CONSTRAINT "sales_events_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "context_sources"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "tender_rounds" ADD CONSTRAINT "tender_rounds_purchase_request_id_fkey" FOREIGN KEY ("purchase_request_id") REFERENCES "purchase_requests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- PostgreSQL invariants not represented by Prisma's data model.
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_kind_check CHECK ((kind = ANY (ARRAY['OFFER_RECOMMENDATION'::text, 'NEGOTIATION_DRAFT'::text])));
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_status_check CHECK ((status = ANY (ARRAY['SUCCEEDED'::text, 'REJECTED_BY_POLICY'::text, 'FAILED'::text])));
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_actor_type_check CHECK ((actor_type = ANY (ARRAY['USER'::text, 'INTEGRATION'::text, 'AGENT'::text, 'SYSTEM'::text])));
ALTER TABLE public.companies ADD CONSTRAINT companies_kind_check CHECK ((kind = ANY (ARRAY['BUYER'::text, 'SUPPLIER'::text, 'BOTH'::text])));
ALTER TABLE public.companies ADD CONSTRAINT companies_slug_check CHECK ((slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'::text));
ALTER TABLE public.company_objectives ADD CONSTRAINT company_objectives_target_days_of_stock_check CHECK ((target_days_of_stock > 0));
ALTER TABLE public.company_objectives ADD CONSTRAINT company_objectives_target_margin_percentage_check CHECK (((target_margin_percentage >= (0)::numeric) AND (target_margin_percentage < (100)::numeric)));
ALTER TABLE public.company_objectives ADD CONSTRAINT company_objectives_target_rotation_days_check CHECK ((target_rotation_days > 0));
ALTER TABLE public.company_objectives ADD CONSTRAINT company_objectives_target_stock_capital_check CHECK ((target_stock_capital >= (0)::numeric));
ALTER TABLE public.context_events ADD CONSTRAINT context_events_event_type_check CHECK ((event_type = ANY (ARRAY['inventory.updated'::text, 'sale.completed'::text])));
ALTER TABLE public.context_sources ADD CONSTRAINT context_sources_kind_check CHECK ((kind = ANY (ARRAY['ERP'::text, 'MANUAL'::text, 'EXTERNAL_API'::text])));
ALTER TABLE public.inventory_snapshots ADD CONSTRAINT inventory_snapshots_in_transit_check CHECK ((in_transit >= (0)::numeric));
ALTER TABLE public.inventory_snapshots ADD CONSTRAINT inventory_snapshots_on_hand_check CHECK ((on_hand >= (0)::numeric));
ALTER TABLE public.inventory_snapshots ADD CONSTRAINT inventory_snapshots_reserved_check CHECK ((reserved >= (0)::numeric));
ALTER TABLE public.mandates ADD CONSTRAINT mandates_allowed_suppliers_check CHECK ((cardinality(allowed_suppliers) > 0));
ALTER TABLE public.mandates ADD CONSTRAINT mandates_check CHECK ((expires_at > approved_at));
ALTER TABLE public.mandates ADD CONSTRAINT mandates_currency_check CHECK ((currency = 'ARS'::text));
ALTER TABLE public.mandates ADD CONSTRAINT mandates_maximum_total_including_fees_check CHECK ((maximum_total_including_fees > (0)::numeric));
ALTER TABLE public.mandates ADD CONSTRAINT mandates_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'REVOKED'::text, 'EXPIRED'::text, 'CONSUMED'::text])));
ALTER TABLE public.mandates ADD CONSTRAINT mandates_version_check CHECK ((version > 0));
ALTER TABLE public.negotiation_messages ADD CONSTRAINT negotiation_messages_check CHECK ((sender_company_id <> recipient_company_id));
ALTER TABLE public.negotiation_messages ADD CONSTRAINT negotiation_messages_message_type_check CHECK ((message_type = ANY (ARRAY['request_for_quote'::text, 'offer'::text, 'counteroffer'::text, 'availability_update'::text, 'best_and_final_request'::text, 'final_offer'::text, 'acceptance'::text, 'rejection'::text, 'purchase_order'::text, 'payment_status'::text, 'receipt_confirmation'::text])));
ALTER TABLE public.negotiation_metrics ADD CONSTRAINT negotiation_metrics_duration_ms_check CHECK ((duration_ms >= 0));
ALTER TABLE public.negotiation_metrics ADD CONSTRAINT negotiation_metrics_final_total_check CHECK ((final_total >= (0)::numeric));
ALTER TABLE public.negotiation_metrics ADD CONSTRAINT negotiation_metrics_initial_total_check CHECK ((initial_total >= (0)::numeric));
ALTER TABLE public.negotiation_metrics ADD CONSTRAINT negotiation_metrics_message_count_check CHECK ((message_count > 0));
ALTER TABLE public.negotiation_metrics ADD CONSTRAINT negotiation_metrics_rounds_check CHECK ((rounds > 0));
ALTER TABLE public.negotiation_metrics ADD CONSTRAINT negotiation_metrics_stock_available_check CHECK ((stock_available >= (0)::numeric));
ALTER TABLE public.negotiations ADD CONSTRAINT negotiations_check CHECK ((buyer_company_id <> supplier_company_id));
ALTER TABLE public.negotiations ADD CONSTRAINT negotiations_status_check CHECK ((status = ANY (ARRAY['OPEN'::text, 'FINAL_OFFERED'::text, 'PARTIALLY_AWARDED'::text, 'ACCEPTED'::text, 'REJECTED'::text, 'EXPIRED'::text, 'CANCELLED'::text])));
ALTER TABLE public.offer_lines ADD CONSTRAINT offer_lines_quantity_check CHECK ((quantity > (0)::numeric));
ALTER TABLE public.offer_lines ADD CONSTRAINT offer_lines_shipping_check CHECK ((shipping >= (0)::numeric));
ALTER TABLE public.offer_lines ADD CONSTRAINT offer_lines_subtotal_check CHECK ((subtotal >= (0)::numeric));
ALTER TABLE public.offer_lines ADD CONSTRAINT offer_lines_taxes_check CHECK ((taxes >= (0)::numeric));
ALTER TABLE public.offer_lines ADD CONSTRAINT offer_lines_total_check CHECK ((total >= (0)::numeric));
ALTER TABLE public.offer_lines ADD CONSTRAINT offer_lines_unit_price_check CHECK ((unit_price >= (0)::numeric));
ALTER TABLE public.offers ADD CONSTRAINT offers_currency_check CHECK ((currency = 'ARS'::text));
ALTER TABLE public.offers ADD CONSTRAINT offers_discount_check CHECK ((discount >= (0)::numeric));
ALTER TABLE public.offers ADD CONSTRAINT offers_shipping_check CHECK ((shipping >= (0)::numeric));
ALTER TABLE public.offers ADD CONSTRAINT offers_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'SUPERSEDED'::text, 'ACCEPTED'::text, 'REJECTED'::text, 'EXPIRED'::text])));
ALTER TABLE public.offers ADD CONSTRAINT offers_subtotal_check CHECK ((subtotal >= (0)::numeric));
ALTER TABLE public.offers ADD CONSTRAINT offers_taxes_check CHECK ((taxes >= (0)::numeric));
ALTER TABLE public.offers ADD CONSTRAINT offers_total_check CHECK ((total >= (0)::numeric));
ALTER TABLE public.products ADD CONSTRAINT products_unit_cost_check CHECK ((unit_cost >= (0)::numeric));
ALTER TABLE public.purchase_order_items ADD CONSTRAINT purchase_order_items_quantity_check CHECK ((quantity > (0)::numeric));
ALTER TABLE public.purchase_order_items ADD CONSTRAINT purchase_order_items_shipping_check CHECK ((shipping >= (0)::numeric));
ALTER TABLE public.purchase_order_items ADD CONSTRAINT purchase_order_items_subtotal_check CHECK ((subtotal >= (0)::numeric));
ALTER TABLE public.purchase_order_items ADD CONSTRAINT purchase_order_items_taxes_check CHECK ((taxes >= (0)::numeric));
ALTER TABLE public.purchase_order_items ADD CONSTRAINT purchase_order_items_total_check CHECK ((total >= (0)::numeric));
ALTER TABLE public.purchase_order_items ADD CONSTRAINT purchase_order_items_unit_price_check CHECK ((unit_price >= (0)::numeric));
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_currency_check CHECK ((currency = 'ARS'::text));
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_shipping_check CHECK ((shipping >= (0)::numeric));
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_status_check CHECK ((status = ANY (ARRAY['CREATED'::text, 'CANCELLED'::text])));
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_subtotal_check CHECK ((subtotal >= (0)::numeric));
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_taxes_check CHECK ((taxes >= (0)::numeric));
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_total_check CHECK ((total >= (0)::numeric));
ALTER TABLE public.purchase_request_items ADD CONSTRAINT purchase_request_items_check CHECK (((minimum_quantity <= target_quantity) AND (target_quantity <= maximum_quantity)));
ALTER TABLE public.purchase_request_items ADD CONSTRAINT purchase_request_items_maximum_quantity_check CHECK ((maximum_quantity > (0)::numeric));
ALTER TABLE public.purchase_request_items ADD CONSTRAINT purchase_request_items_minimum_quantity_check CHECK ((minimum_quantity > (0)::numeric));
ALTER TABLE public.purchase_request_items ADD CONSTRAINT purchase_request_items_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'AWARDED'::text])));
ALTER TABLE public.purchase_request_items ADD CONSTRAINT purchase_request_items_target_quantity_check CHECK ((target_quantity > (0)::numeric));
ALTER TABLE public.purchase_requests ADD CONSTRAINT purchase_requests_check CHECK ((expires_at > created_at));
ALTER TABLE public.purchase_requests ADD CONSTRAINT purchase_requests_currency_check CHECK ((currency = 'ARS'::text));
ALTER TABLE public.purchase_requests ADD CONSTRAINT purchase_requests_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'AWAITING_APPROVAL'::text, 'APPROVED'::text, 'NEGOTIATING'::text, 'RECOMMENDED'::text, 'POLICY_VALIDATED'::text, 'FUNDS_RESERVED'::text, 'OFFER_ACCEPTED'::text, 'PARTIALLY_ORDERED'::text, 'ORDER_CREATED'::text, 'PAYMENT_PENDING'::text, 'PAYMENT_CONFIRMED'::text, 'RECONCILED'::text, 'REJECTED'::text, 'EXPIRED'::text, 'CANCELLED'::text, 'REAPPROVAL_REQUIRED'::text])));
ALTER TABLE public.purchase_requests ADD CONSTRAINT purchase_requests_version_check CHECK ((version > 0));
ALTER TABLE public.sales_events ADD CONSTRAINT sales_events_quantity_check CHECK ((quantity > (0)::numeric));
ALTER TABLE public.sales_events ADD CONSTRAINT sales_events_unit_price_check CHECK ((unit_price >= (0)::numeric));
ALTER TABLE public.tender_rounds ADD CONSTRAINT tender_rounds_request_item_ids_check CHECK ((cardinality(request_item_ids) > 0));
ALTER TABLE public.tender_rounds ADD CONSTRAINT tender_rounds_round_number_check CHECK ((round_number > 0));
ALTER TABLE public.tender_rounds ADD CONSTRAINT tender_rounds_status_check CHECK ((status = ANY (ARRAY['OPEN'::text, 'PARTIAL'::text, 'COMPLETED'::text])));
CREATE UNIQUE INDEX mandates_one_active_per_request ON public.mandates USING btree (purchase_request_id) WHERE (status = 'ACTIVE'::text);
CREATE UNIQUE INDEX tender_rounds_one_open_per_request ON public.tender_rounds USING btree (purchase_request_id) WHERE (status = 'OPEN'::text);
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_objectives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.context_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.context_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.domain_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mandates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.negotiation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.negotiation_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.negotiations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offer_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tender_rounds ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
  END IF;
END $$;
