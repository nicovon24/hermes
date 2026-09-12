begin;

alter table public.payments rename column "txHash" to tx_hash;

alter table public.payments
  add column purchase_order_id uuid,
  add column attempt_count integer not null default 0,
  add column last_error text,
  add column submitted_at timestamp without time zone,
  add column confirmed_at timestamp without time zone;

alter table public.payments
  add constraint payments_purchase_order_id_fkey
    foreign key (purchase_order_id) references public.purchase_orders(id) on delete restrict;

create unique index payments_purchase_order_id_key
  on public.payments (purchase_order_id);
create unique index payments_external_reference_key
  on public.payments (external_reference);
create index payments_conversation_id_idx
  on public.payments (conversation_id);
create index payments_payer_agent_id_idx
  on public.payments (payer_agent_id);
create index payments_payee_agent_id_idx
  on public.payments (payee_agent_id);
create index payments_status_idx
  on public.payments (status);
create index payment_events_payment_id_idx
  on public.payment_events (payment_id);

alter table public.purchase_requests
  drop constraint purchase_requests_status_check;
alter table public.purchase_requests
  add constraint purchase_requests_status_check check (status in (
    'DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'NEGOTIATING', 'RECOMMENDED',
    'POLICY_VALIDATED', 'FUNDS_RESERVED', 'OFFER_ACCEPTED', 'PARTIALLY_ORDERED',
    'ORDER_CREATED', 'PAYMENT_PENDING', 'PAYMENT_CONFIRMED',
    'PAYMENT_REVIEW_REQUIRED', 'RECONCILED', 'REJECTED', 'EXPIRED',
    'CANCELLED', 'REAPPROVAL_REQUIRED'
  ));

alter table public.agents enable row level security;
alter table public.payments enable row level security;
alter table public.payment_events enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.agents, public.payments, public.payment_events from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.agents, public.payments, public.payment_events from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.agents, public.payments, public.payment_events to service_role;
  end if;
end $$;

commit;
