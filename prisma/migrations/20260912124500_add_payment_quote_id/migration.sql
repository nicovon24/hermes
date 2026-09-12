ALTER TABLE "payments"
ADD COLUMN IF NOT EXISTS "quote_id" TEXT;

CREATE INDEX IF NOT EXISTS "payments_quote_id_idx" ON "payments"("quote_id");
