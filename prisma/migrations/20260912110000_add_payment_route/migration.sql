ALTER TABLE public.payments
ADD COLUMN IF NOT EXISTS route text
DEFAULT 'ARBITRUM_DIRECT'
NOT NULL;

ALTER TABLE public.payments
DROP CONSTRAINT IF EXISTS payments_route_check;

ALTER TABLE public.payments
ADD CONSTRAINT payments_route_check
CHECK (route IN ('ARBITRUM_DIRECT', 'SOLANA_TO_ARBITRUM'));
