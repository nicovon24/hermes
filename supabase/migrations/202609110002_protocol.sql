begin;

create extension if not exists pgcrypto;
create schema if not exists private;

create table public.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  buyer_company_id uuid not null references public.companies(id),
  status text not null default 'AWAITING_APPROVAL' check (status in (
    'DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'NEGOTIATING', 'RECOMMENDED',
    'POLICY_VALIDATED', 'FUNDS_RESERVED', 'OFFER_ACCEPTED', 'ORDER_CREATED',
    'PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'RECONCILED', 'REJECTED',
    'EXPIRED', 'CANCELLED', 'REAPPROVAL_REQUIRED'
  )),
  currency text not null check (currency = 'ARS'),
  required_by date not null,
  expires_at timestamptz not null,
  created_by text not null,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create table public.purchase_request_items (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references public.purchase_requests(id) on delete cascade,
  product_id text not null,
  description text not null,
  unit text not null,
  minimum_quantity numeric(24, 6) not null check (minimum_quantity > 0),
  target_quantity numeric(24, 6) not null check (target_quantity > 0),
  maximum_quantity numeric(24, 6) not null check (maximum_quantity > 0),
  created_at timestamptz not null default now(),
  check (minimum_quantity <= target_quantity and target_quantity <= maximum_quantity)
);

create table public.mandates (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references public.purchase_requests(id),
  buyer_company_id uuid not null references public.companies(id),
  approved_by text not null,
  version integer not null check (version > 0),
  currency text not null check (currency = 'ARS'),
  maximum_total_including_fees numeric(20, 2) not null check (maximum_total_including_fees > 0),
  allowed_suppliers uuid[] not null check (cardinality(allowed_suppliers) > 0),
  payment_terms text not null,
  settlement_asset text not null,
  auto_accept boolean not null default false,
  auto_pay boolean not null default false,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'REVOKED', 'EXPIRED', 'CONSUMED')),
  approved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (purchase_request_id, version),
  check (expires_at > approved_at)
);

create unique index mandates_one_active_per_request
  on public.mandates (purchase_request_id)
  where status = 'ACTIVE';

create table public.negotiations (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references public.purchase_requests(id) on delete cascade,
  buyer_company_id uuid not null references public.companies(id),
  supplier_company_id uuid not null references public.companies(id),
  status text not null default 'OPEN' check (status in ('OPEN', 'FINAL_OFFERED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (purchase_request_id, supplier_company_id),
  check (buyer_company_id <> supplier_company_id)
);

create table public.negotiation_messages (
  id uuid primary key,
  negotiation_id uuid not null references public.negotiations(id) on delete cascade,
  purchase_request_id uuid not null references public.purchase_requests(id) on delete cascade,
  protocol_version text not null,
  message_type text not null check (message_type in (
    'request_for_quote', 'offer', 'counteroffer', 'availability_update',
    'best_and_final_request', 'final_offer', 'acceptance', 'rejection',
    'purchase_order', 'payment_status', 'receipt_confirmation'
  )),
  sender_company_id uuid not null references public.companies(id),
  recipient_company_id uuid not null references public.companies(id),
  correlation_id uuid,
  sent_at timestamptz not null,
  expires_at timestamptz,
  idempotency_key text not null,
  payload jsonb not null,
  raw_message jsonb not null,
  created_at timestamptz not null default now(),
  unique (sender_company_id, idempotency_key),
  check (sender_company_id <> recipient_company_id)
);

create table public.offers (
  id uuid primary key,
  negotiation_id uuid not null references public.negotiations(id) on delete cascade,
  purchase_request_id uuid not null references public.purchase_requests(id) on delete cascade,
  supplier_company_id uuid not null references public.companies(id),
  message_id uuid not null unique references public.negotiation_messages(id),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUPERSEDED', 'ACCEPTED', 'REJECTED', 'EXPIRED')),
  currency text not null check (currency = 'ARS'),
  valid_until timestamptz not null,
  subtotal numeric(20, 2) not null check (subtotal >= 0),
  taxes numeric(20, 2) not null check (taxes >= 0),
  shipping numeric(20, 2) not null check (shipping >= 0),
  discount numeric(20, 2) not null check (discount >= 0),
  total numeric(20, 2) not null check (total >= 0),
  delivery_date date not null,
  payment_terms text not null,
  confirmed_stock boolean not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  purchase_request_id uuid not null references public.purchase_requests(id) on delete cascade,
  kind text not null check (kind in ('OFFER_RECOMMENDATION', 'NEGOTIATION_DRAFT')),
  provider text not null,
  model text not null,
  input_snapshot jsonb not null,
  output jsonb not null,
  status text not null check (status in ('SUCCEEDED', 'REJECTED_BY_POLICY', 'FAILED')),
  created_by text not null,
  created_at timestamptz not null default now()
);

create table public.domain_events (
  id uuid primary key default gen_random_uuid(),
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  payload jsonb not null,
  occurred_at timestamptz not null default now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  company_id uuid references public.companies(id),
  actor_type text not null check (actor_type in ('USER', 'INTEGRATION', 'AGENT', 'SYSTEM')),
  actor_id text not null,
  action text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index purchase_requests_buyer_status_idx
  on public.purchase_requests (buyer_company_id, status, created_at desc);
create index negotiations_request_idx on public.negotiations (purchase_request_id);
create index negotiations_supplier_idx on public.negotiations (supplier_company_id, status);
create index messages_negotiation_sent_idx
  on public.negotiation_messages (negotiation_id, sent_at, created_at);
create index offers_request_active_idx
  on public.offers (purchase_request_id, status, valid_until);
create index domain_events_aggregate_idx
  on public.domain_events (aggregate_type, aggregate_id, occurred_at);

create trigger purchase_requests_set_updated_at
before update on public.purchase_requests
for each row execute function private.set_updated_at();

create trigger negotiations_set_updated_at
before update on public.negotiations
for each row execute function private.set_updated_at();

alter table public.purchase_requests enable row level security;
alter table public.purchase_request_items enable row level security;
alter table public.mandates enable row level security;
alter table public.negotiations enable row level security;
alter table public.negotiation_messages enable row level security;
alter table public.offers enable row level security;
alter table public.agent_runs enable row level security;
alter table public.domain_events enable row level security;
alter table public.audit_log enable row level security;

revoke all on public.purchase_requests, public.purchase_request_items,
  public.mandates, public.negotiations, public.negotiation_messages,
  public.offers, public.agent_runs,
  public.domain_events, public.audit_log
from anon, authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;

create function public.create_purchase_request_command(
  p_buyer_company_id uuid,
  p_created_by text,
  p_currency text,
  p_required_by date,
  p_expires_at timestamptz,
  p_items jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request_id uuid := gen_random_uuid();
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one item is required' using errcode = '22023';
  end if;

  insert into public.purchase_requests (
    id, buyer_company_id, status, currency, required_by, expires_at, created_by
  ) values (
    request_id, p_buyer_company_id, 'AWAITING_APPROVAL', p_currency,
    p_required_by, p_expires_at, p_created_by
  );

  insert into public.purchase_request_items (
    purchase_request_id, product_id, description, unit,
    minimum_quantity, target_quantity, maximum_quantity
  )
  select
    request_id,
    item."productId",
    item.description,
    item.unit,
    item."minimumQuantity",
    item."targetQuantity",
    item."maximumQuantity"
  from jsonb_to_recordset(p_items) as item(
    "productId" text,
    description text,
    unit text,
    "minimumQuantity" numeric,
    "targetQuantity" numeric,
    "maximumQuantity" numeric
  );

  insert into public.domain_events (aggregate_type, aggregate_id, event_type, payload)
  values (
    'purchase_request', request_id, 'purchase_request.approval_required',
    jsonb_build_object('purchaseRequestId', request_id, 'buyerCompanyId', p_buyer_company_id)
  );

  insert into public.audit_log (
    company_id, actor_type, actor_id, action, aggregate_type, aggregate_id
  ) values (
    p_buyer_company_id, 'USER', p_created_by, 'purchase_request.created',
    'purchase_request', request_id
  );

  return request_id;
end;
$$;

create function public.approve_purchase_request_command(
  p_purchase_request_id uuid,
  p_buyer_company_id uuid,
  p_approved_by text,
  p_maximum_total numeric,
  p_allowed_suppliers uuid[],
  p_payment_terms text,
  p_settlement_asset text,
  p_auto_accept boolean,
  p_auto_pay boolean,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  locked_request public.purchase_requests%rowtype;
  mandate_id uuid := gen_random_uuid();
  next_version integer;
begin
  select * into locked_request
  from public.purchase_requests
  where id = p_purchase_request_id
  for update;

  if not found or locked_request.buyer_company_id <> p_buyer_company_id then
    raise exception 'Purchase request not found' using errcode = 'P0002';
  end if;
  if locked_request.status <> 'AWAITING_APPROVAL' then
    raise exception 'Purchase request cannot be approved from state %', locked_request.status
      using errcode = '23514';
  end if;
  if p_expires_at <= now() then
    raise exception 'Mandate must expire in the future' using errcode = '22023';
  end if;

  select coalesce(max(version), 0) + 1 into next_version
  from public.mandates
  where purchase_request_id = p_purchase_request_id;

  insert into public.mandates (
    id, purchase_request_id, buyer_company_id, approved_by, version, currency,
    maximum_total_including_fees, allowed_suppliers, payment_terms,
    settlement_asset, auto_accept, auto_pay, expires_at
  ) values (
    mandate_id, p_purchase_request_id, p_buyer_company_id, p_approved_by,
    next_version, locked_request.currency, p_maximum_total, p_allowed_suppliers,
    p_payment_terms, p_settlement_asset, p_auto_accept, p_auto_pay, p_expires_at
  );

  insert into public.negotiations (
    purchase_request_id, buyer_company_id, supplier_company_id
  )
  select p_purchase_request_id, p_buyer_company_id, supplier_id
  from unnest(p_allowed_suppliers) supplier_id
  on conflict (purchase_request_id, supplier_company_id) do nothing;

  update public.purchase_requests
  set status = 'NEGOTIATING', version = version + 1
  where id = p_purchase_request_id;

  insert into public.domain_events (aggregate_type, aggregate_id, event_type, payload)
  values (
    'purchase_request', p_purchase_request_id, 'purchase_request.approved',
    jsonb_build_object(
      'purchaseRequestId', p_purchase_request_id,
      'mandateId', mandate_id,
      'allowedSuppliers', to_jsonb(p_allowed_suppliers)
    )
  );

  insert into public.audit_log (
    company_id, actor_type, actor_id, action, aggregate_type, aggregate_id,
    metadata
  ) values (
    p_buyer_company_id, 'USER', p_approved_by, 'purchase_request.approved',
    'purchase_request', p_purchase_request_id,
    jsonb_build_object('mandateId', mandate_id)
  );

  return mandate_id;
end;
$$;

create function public.append_protocol_message_command(
  p_message jsonb,
  p_actor_type text,
  p_actor_id text
)
returns table(message_id uuid, was_duplicate boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  negotiation public.negotiations%rowtype;
  existing_id uuid;
  new_message_id uuid := (p_message->>'messageId')::uuid;
  message_kind text := p_message->>'type';
  sender_id uuid := (p_message->>'senderCompanyId')::uuid;
  recipient_id uuid := (p_message->>'recipientCompanyId')::uuid;
  request_id uuid := (p_message->>'purchaseRequestId')::uuid;
  negotiation_id uuid := (p_message->>'negotiationId')::uuid;
  body jsonb := p_message->'payload';
begin
  select id into existing_id
  from public.negotiation_messages
  where sender_company_id = sender_id
    and idempotency_key = p_message->>'idempotencyKey';

  if existing_id is not null then
    return query select existing_id, true;
    return;
  end if;

  select * into negotiation
  from public.negotiations
  where id = negotiation_id
  for update;

  if not found or negotiation.purchase_request_id <> request_id then
    raise exception 'Negotiation not found' using errcode = 'P0002';
  end if;
  if not (
    sender_id in (negotiation.buyer_company_id, negotiation.supplier_company_id)
    and recipient_id in (negotiation.buyer_company_id, negotiation.supplier_company_id)
    and sender_id <> recipient_id
  ) then
    raise exception 'Message participants do not match negotiation' using errcode = '42501';
  end if;
  if message_kind in ('offer', 'final_offer', 'availability_update')
    and sender_id <> negotiation.supplier_company_id then
    raise exception 'Only the supplier can send this message type' using errcode = '42501';
  end if;
  if message_kind in (
    'request_for_quote', 'best_and_final_request', 'acceptance',
    'purchase_order', 'receipt_confirmation'
  ) and sender_id <> negotiation.buyer_company_id then
    raise exception 'Only the buyer can send this message type' using errcode = '42501';
  end if;

  insert into public.negotiation_messages (
    id, negotiation_id, purchase_request_id, protocol_version, message_type,
    sender_company_id, recipient_company_id, correlation_id, sent_at,
    expires_at, idempotency_key, payload, raw_message
  ) values (
    new_message_id, negotiation_id, request_id, p_message->>'protocolVersion',
    message_kind, sender_id, recipient_id,
    nullif(p_message->>'correlationId', '')::uuid,
    (p_message->>'sentAt')::timestamptz,
    nullif(p_message->>'expiresAt', '')::timestamptz,
    p_message->>'idempotencyKey', body, p_message
  );

  if message_kind in ('offer', 'counteroffer', 'final_offer')
    and sender_id = negotiation.supplier_company_id then
    update public.offers existing_offer
    set status = 'SUPERSEDED'
    where existing_offer.negotiation_id = negotiation.id
      and existing_offer.status = 'ACTIVE';

    insert into public.offers (
      id, negotiation_id, purchase_request_id, supplier_company_id, message_id,
      currency, valid_until, subtotal, taxes, shipping, discount, total,
      delivery_date, payment_terms, confirmed_stock, payload
    ) values (
      (body->>'offerId')::uuid, negotiation.id, request_id,
      negotiation.supplier_company_id, new_message_id, body->>'currency',
      (body->>'validUntil')::timestamptz, (body->>'subtotal')::numeric,
      (body->>'taxes')::numeric, (body->>'shipping')::numeric,
      (body->>'discount')::numeric, (body->>'total')::numeric,
      (body->>'deliveryDate')::date, body->>'paymentTerms',
      (body->>'confirmedStock')::boolean, body
    );

    if message_kind = 'final_offer' then
      update public.negotiations set status = 'FINAL_OFFERED' where id = negotiation.id;
    end if;
  end if;

  insert into public.domain_events (aggregate_type, aggregate_id, event_type, payload)
  values (
    'negotiation', negotiation.id, 'protocol.' || message_kind,
    jsonb_build_object(
      'messageId', new_message_id,
      'negotiationId', negotiation.id,
      'purchaseRequestId', request_id,
      'senderCompanyId', sender_id,
      'recipientCompanyId', recipient_id
    )
  );

  insert into public.audit_log (
    company_id, actor_type, actor_id, action, aggregate_type, aggregate_id,
    metadata
  ) values (
    sender_id, p_actor_type, p_actor_id, 'protocol.' || message_kind,
    'negotiation', negotiation.id, jsonb_build_object('messageId', new_message_id)
  );

  return query select new_message_id, false;
end;
$$;

create function public.record_agent_recommendation_command(
  p_company_id uuid,
  p_purchase_request_id uuid,
  p_created_by text,
  p_model text,
  p_input_snapshot jsonb,
  p_output jsonb,
  p_status text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  run_id uuid := gen_random_uuid();
begin
  insert into public.agent_runs (
    id, company_id, purchase_request_id, kind, provider, model,
    input_snapshot, output, status, created_by
  ) values (
    run_id, p_company_id, p_purchase_request_id, 'OFFER_RECOMMENDATION',
    'GROQ', p_model, p_input_snapshot, p_output, p_status, p_created_by
  );

  if p_status = 'SUCCEEDED' then
    update public.purchase_requests
    set status = 'RECOMMENDED', version = version + 1
    where id = p_purchase_request_id and status = 'NEGOTIATING';
  end if;

  insert into public.domain_events (aggregate_type, aggregate_id, event_type, payload)
  values (
    'purchase_request', p_purchase_request_id,
    case when p_status = 'SUCCEEDED'
      then 'negotiation.recommendation_ready'
      else 'negotiation.recommendation_rejected'
    end,
    jsonb_build_object('purchaseRequestId', p_purchase_request_id, 'agentRunId', run_id)
  );

  return run_id;
end;
$$;

revoke all on function public.create_purchase_request_command(uuid, text, text, date, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.approve_purchase_request_command(uuid, uuid, text, numeric, uuid[], text, text, boolean, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.append_protocol_message_command(jsonb, text, text) from public, anon, authenticated;
revoke all on function public.record_agent_recommendation_command(uuid, uuid, text, text, jsonb, jsonb, text) from public, anon, authenticated;

grant execute on function public.create_purchase_request_command(uuid, text, text, date, timestamptz, jsonb) to service_role;
grant execute on function public.approve_purchase_request_command(uuid, uuid, text, numeric, uuid[], text, text, boolean, boolean, timestamptz) to service_role;
grant execute on function public.append_protocol_message_command(jsonb, text, text) to service_role;
grant execute on function public.record_agent_recommendation_command(uuid, uuid, text, text, jsonb, jsonb, text) to service_role;

commit;
