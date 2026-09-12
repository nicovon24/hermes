-- Adds the cross-chain quote contract from the latest Hermes payment rollout.
CREATE TYPE "quote_status" AS ENUM (
  'QUOTE_CREATED',
  'QUOTE_ACCEPTED',
  'EXPIRED',
  'REJECTED',
  'SETTLED'
);

CREATE TABLE "quotes" (
  "id" TEXT NOT NULL,
  "purchase_order_id" TEXT,
  "accepted_offer_id" TEXT,
  "supplier_agent_id" TEXT,
  "source_network" TEXT NOT NULL,
  "source_token" TEXT NOT NULL,
  "source_amount" TEXT NOT NULL,
  "destination_network" TEXT NOT NULL,
  "destination_token" TEXT NOT NULL,
  "destination_amount" TEXT NOT NULL,
  "bridge_fee" TEXT NOT NULL,
  "swap_fee" TEXT NOT NULL,
  "gas_fee" TEXT NOT NULL,
  "hermes_fee" TEXT NOT NULL,
  "status" "quote_status" NOT NULL DEFAULT 'QUOTE_CREATED',
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "quotes_status_idx" ON "quotes"("status");
CREATE INDEX "quotes_expires_at_idx" ON "quotes"("expires_at");
