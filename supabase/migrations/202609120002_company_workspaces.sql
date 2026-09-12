begin;

-- Commercial identity used by each company workspace.
create table public.company_profiles (
  company_id uuid primary key references public.companies(id) on delete cascade,
  tax_id text not null,
  address_line text not null,
  city text not null,
  province text not null,
  contact_name text not null,
  contact_email text not null,
  contact_phone text not null,
  delivery_area text not null,
  updated_at timestamptz not null default now()
);

insert into public.company_profiles (
  company_id, tax_id, address_line, city, province,
  contact_name, contact_email, contact_phone, delivery_area
) values
  ('00000000-0000-4000-8000-000000000001', '30-71824591-6', 'Av. Colón 1840', 'Córdoba', 'Córdoba', 'Sofía Benítez', 'compras@puntocentro.demo', '+54 351 555-0101', 'Córdoba Capital'),
  ('00000000-0000-4000-8000-000000000101', '30-70918234-2', 'Ruta 9 km 695', 'Jesús María', 'Córdoba', 'Martín Quiroga', 'ventas@norte.demo', '+54 3525 555-101', 'Centro y norte de Córdoba'),
  ('00000000-0000-4000-8000-000000000102', '30-71567342-8', 'Colectora Sur 420', 'Villa Allende', 'Córdoba', 'Carla Ferreyra', 'cuentas@andino.demo', '+54 3543 555-102', 'Gran Córdoba y Sierras Chicas'),
  ('00000000-0000-4000-8000-000000000103', '30-72301987-4', 'Camino Interfábricas 2280', 'Córdoba', 'Córdoba', 'Julián Roldán', 'pedidos@sur.demo', '+54 351 555-0103', 'Centro y sur de Córdoba')
on conflict (company_id) do update set
  tax_id = excluded.tax_id,
  address_line = excluded.address_line,
  city = excluded.city,
  province = excluded.province,
  contact_name = excluded.contact_name,
  contact_email = excluded.contact_email,
  contact_phone = excluded.contact_phone,
  delivery_area = excluded.delivery_area,
  updated_at = now();

-- Deliberate coverage gaps make the demo exercise line-level availability:
-- every distributor can quote part of a consolidated basket, but not all of it.
select public.record_inventory_snapshot_command(
  '00000000-0000-4000-8000-000000000101', 'multi-product-demo', 'ERP',
  'erp-distribuidora-norte', 'workspace-v3-norte-yerba', 'YERBA-1000',
  'Yerba mate 1 kg', 'unidad', 18, 10, 20, now()
);
select public.record_inventory_snapshot_command(
  '00000000-0000-4000-8000-000000000102', 'multi-product-demo', 'ERP',
  'erp-mayorista-andino', 'workspace-v3-andino-arroz', 'ARROZ-1000',
  'Arroz largo fino 1 kg', 'unidad', 12, 8, 25, now()
);
select public.record_inventory_snapshot_command(
  '00000000-0000-4000-8000-000000000103', 'multi-product-demo', 'ERP',
  'erp-abastecimientos-sur', 'workspace-v3-sur-azucar', 'AZUCAR-1000',
  'Azúcar 1 kg', 'unidad', 12, 9, 20, now()
);

alter table public.purchase_requests
  drop constraint purchase_requests_status_check;
alter table public.purchase_requests
  add constraint purchase_requests_status_check check (status in (
    'DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'NEGOTIATING', 'RECOMMENDED',
    'POLICY_VALIDATED', 'FUNDS_RESERVED', 'OFFER_ACCEPTED', 'PARTIALLY_ORDERED',
    'ORDER_CREATED', 'PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'RECONCILED',
    'REJECTED', 'EXPIRED', 'CANCELLED', 'REAPPROVAL_REQUIRED'
  ));

alter table public.purchase_request_items
  add column status text not null default 'PENDING'
    check (status in ('PENDING', 'AWARDED')),
  add column pending_reason text,
  add column urgency_score numeric(20, 6) not null default 999999,
  add column awarded_at timestamptz;

alter table public.negotiations
  drop constraint negotiations_status_check;
alter table public.negotiations
  add constraint negotiations_status_check check (status in (
    'OPEN', 'FINAL_OFFERED', 'PARTIALLY_AWARDED', 'ACCEPTED',
    'REJECTED', 'EXPIRED', 'CANCELLED'
  ));

create table public.tender_rounds (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references public.purchase_requests(id) on delete cascade,
  round_number integer not null check (round_number > 0),
  status text not null default 'OPEN' check (status in ('OPEN', 'PARTIAL', 'COMPLETED')),
  request_item_ids uuid[] not null check (cardinality(request_item_ids) > 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (purchase_request_id, round_number)
);

create unique index tender_rounds_one_open_per_request
  on public.tender_rounds (purchase_request_id)
  where status = 'OPEN';

alter table public.negotiation_messages
  add column tender_round_id uuid references public.tender_rounds(id);
alter table public.offers
  add column tender_round_id uuid references public.tender_rounds(id);

create table public.offer_lines (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers(id) on delete cascade,
  purchase_request_id uuid not null references public.purchase_requests(id) on delete cascade,
  request_item_id uuid not null references public.purchase_request_items(id) on delete cascade,
  product_id text not null,
  description text not null,
  unit text not null,
  quantity numeric(24, 6) not null check (quantity > 0),
  unit_price numeric(20, 2) not null check (unit_price >= 0),
  subtotal numeric(20, 2) not null check (subtotal >= 0),
  taxes numeric(20, 2) not null check (taxes >= 0),
  shipping numeric(20, 2) not null check (shipping >= 0),
  total numeric(20, 2) not null check (total >= 0),
  confirmed_stock boolean not null,
  delivery_date date not null,
  created_at timestamptz not null default now(),
  unique (offer_id, request_item_id)
);

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references public.purchase_requests(id) on delete restrict,
  tender_round_id uuid not null references public.tender_rounds(id) on delete restrict,
  buyer_company_id uuid not null references public.companies(id),
  supplier_company_id uuid not null references public.companies(id),
  offer_id uuid not null references public.offers(id),
  status text not null default 'CREATED' check (status in ('CREATED', 'CANCELLED')),
  currency text not null default 'ARS' check (currency = 'ARS'),
  subtotal numeric(20, 2) not null default 0 check (subtotal >= 0),
  taxes numeric(20, 2) not null default 0 check (taxes >= 0),
  shipping numeric(20, 2) not null default 0 check (shipping >= 0),
  total numeric(20, 2) not null default 0 check (total >= 0),
  delivery_date date not null,
  payment_terms text not null,
  external_reference text not null unique,
  created_at timestamptz not null default now(),
  unique (tender_round_id, supplier_company_id)
);

create table public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  request_item_id uuid not null unique references public.purchase_request_items(id) on delete restrict,
  offer_line_id uuid not null unique references public.offer_lines(id) on delete restrict,
  product_id text not null,
  description text not null,
  unit text not null,
  quantity numeric(24, 6) not null check (quantity > 0),
  unit_price numeric(20, 2) not null check (unit_price >= 0),
  subtotal numeric(20, 2) not null check (subtotal >= 0),
  taxes numeric(20, 2) not null check (taxes >= 0),
  shipping numeric(20, 2) not null check (shipping >= 0),
  total numeric(20, 2) not null check (total >= 0),
  created_at timestamptz not null default now()
);

create index offer_lines_request_idx
  on public.offer_lines (purchase_request_id, request_item_id, total);
create index purchase_orders_buyer_idx
  on public.purchase_orders (buyer_company_id, created_at desc);
create index purchase_orders_supplier_idx
  on public.purchase_orders (supplier_company_id, created_at desc);

alter table public.company_profiles enable row level security;
alter table public.tender_rounds enable row level security;
alter table public.offer_lines enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;

revoke all on public.company_profiles, public.tender_rounds, public.offer_lines,
  public.purchase_orders, public.purchase_order_items from anon, authenticated;
grant all on public.company_profiles, public.tender_rounds, public.offer_lines,
  public.purchase_orders, public.purchase_order_items to service_role;

-- Attach the round to messages without changing the historical append command.
create function private.protocol_message_round()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.tender_round_id := nullif(new.raw_message->>'tenderRoundId', '')::uuid;
  return new;
end;
$$;

create trigger negotiation_messages_set_round
before insert on public.negotiation_messages
for each row execute function private.protocol_message_round();

-- Normalize every new offer into queryable line economics. Old one-line payloads
-- are supported by resolving the request item through productId.
create function private.offer_round()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.tender_round_id := nullif(new.payload->>'tenderRoundId', '')::uuid;
  return new;
end;
$$;

create trigger offers_set_round
before insert on public.offers
for each row execute function private.offer_round();

create function private.normalize_offer_lines()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  line jsonb;
  resolved_item_id uuid;
  line_count integer := greatest(jsonb_array_length(coalesce(new.payload->'lines', '[]'::jsonb)), 1);
begin

  for line in select value from jsonb_array_elements(coalesce(new.payload->'lines', '[]'::jsonb))
  loop
    resolved_item_id := nullif(line->>'requestItemId', '')::uuid;
    if resolved_item_id is null then
      select item.id into resolved_item_id
      from public.purchase_request_items item
      where item.purchase_request_id = new.purchase_request_id
        and item.product_id = line->>'productId'
      order by item.created_at
      limit 1;
    end if;

    if resolved_item_id is not null then
      insert into public.offer_lines (
        offer_id, purchase_request_id, request_item_id, product_id,
        description, unit, quantity, unit_price, subtotal, taxes,
        shipping, total, confirmed_stock, delivery_date
      ) values (
        new.id, new.purchase_request_id, resolved_item_id,
        line->>'productId', line->>'description', line->>'unit',
        (line->>'quantity')::numeric, (line->>'unitPrice')::numeric,
        coalesce(nullif(line->>'lineTotal', '')::numeric, 0),
        coalesce(nullif(line->>'taxes', '')::numeric, new.taxes / line_count),
        coalesce(nullif(line->>'shipping', '')::numeric, new.shipping / line_count),
        coalesce(
          nullif(line->>'total', '')::numeric,
          coalesce(nullif(line->>'lineTotal', '')::numeric, 0)
            + new.taxes / line_count + new.shipping / line_count
        ),
        coalesce(nullif(line->>'confirmedStock', '')::boolean, new.confirmed_stock),
        coalesce(nullif(line->>'deliveryDate', '')::date, new.delivery_date)
      ) on conflict (offer_id, request_item_id) do nothing;
    end if;
  end loop;
  return new;
end;
$$;

create trigger offers_normalize_lines
after insert on public.offers
for each row execute function private.normalize_offer_lines();

-- A request can be created with an urgency snapshot used for deterministic
-- budget prioritisation. Existing clients that omit it remain compatible.
create or replace function public.create_purchase_request_command(
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
    minimum_quantity, target_quantity, maximum_quantity, urgency_score
  )
  select
    request_id, item."productId", item.description, item.unit,
    item."minimumQuantity", item."targetQuantity", item."maximumQuantity",
    coalesce(item."urgencyScore", 999999)
  from jsonb_to_recordset(p_items) as item(
    "productId" text,
    description text,
    unit text,
    "minimumQuantity" numeric,
    "targetQuantity" numeric,
    "maximumQuantity" numeric,
    "urgencyScore" numeric
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

create function public.start_tender_round_command(
  p_purchase_request_id uuid,
  p_buyer_company_id uuid,
  p_actor_id text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  locked_request public.purchase_requests%rowtype;
  existing_round_id uuid;
  new_round_id uuid := gen_random_uuid();
  next_round integer;
  pending_ids uuid[];
begin
  select * into locked_request
  from public.purchase_requests
  where id = p_purchase_request_id
  for update;

  if not found or locked_request.buyer_company_id <> p_buyer_company_id then
    raise exception 'Purchase request not found' using errcode = 'P0002';
  end if;
  if locked_request.status not in ('NEGOTIATING', 'PARTIALLY_ORDERED') then
    raise exception 'Tender round cannot start from state %', locked_request.status
      using errcode = '23514';
  end if;

  select id into existing_round_id
  from public.tender_rounds
  where purchase_request_id = p_purchase_request_id and status = 'OPEN';
  if existing_round_id is not null then
    return existing_round_id;
  end if;

  select array_agg(id order by urgency_score, created_at) into pending_ids
  from public.purchase_request_items
  where purchase_request_id = p_purchase_request_id and status = 'PENDING';
  if coalesce(cardinality(pending_ids), 0) = 0 then
    raise exception 'No pending request items' using errcode = '23514';
  end if;

  select coalesce(max(round_number), 0) + 1 into next_round
  from public.tender_rounds where purchase_request_id = p_purchase_request_id;

  insert into public.tender_rounds (
    id, purchase_request_id, round_number, request_item_ids
  ) values (new_round_id, p_purchase_request_id, next_round, pending_ids);

  update public.purchase_requests
  set status = 'NEGOTIATING', version = version + 1
  where id = p_purchase_request_id;
  update public.negotiations
  set status = 'OPEN'
  where purchase_request_id = p_purchase_request_id;

  insert into public.audit_log (
    company_id, actor_type, actor_id, action, aggregate_type, aggregate_id,
    metadata
  ) values (
    p_buyer_company_id, 'USER', p_actor_id, 'tender.round_started',
    'purchase_request', p_purchase_request_id,
    jsonb_build_object('tenderRoundId', new_round_id, 'roundNumber', next_round)
  );

  return new_round_id;
end;
$$;

-- Atomically validates allocations, creates one order per winning supplier and
-- leaves uncovered lines ready for the next round. Replaying the command is safe.
create function public.record_split_award_and_orders_command(
  p_purchase_request_id uuid,
  p_buyer_company_id uuid,
  p_tender_round_id uuid,
  p_actor_id text,
  p_recommendation jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  locked_request public.purchase_requests%rowtype;
  active_mandate public.mandates%rowtype;
  allocation jsonb;
  pending jsonb;
  selected_line record;
  order_id uuid;
  existing_order_item uuid;
  spent numeric(20, 2);
  pending_count integer;
  order_row record;
begin
  select * into locked_request from public.purchase_requests
  where id = p_purchase_request_id for update;
  if not found or locked_request.buyer_company_id <> p_buyer_company_id then
    raise exception 'Purchase request not found' using errcode = 'P0002';
  end if;

  if locked_request.status = 'ORDER_CREATED' then
    return jsonb_build_object(
      'status', 'ORDER_CREATED',
      'pendingItems', 0,
      'orders', coalesce((
        select jsonb_agg(jsonb_build_object(
          'purchaseOrderId', purchase_order.id,
          'supplierCompanyId', purchase_order.supplier_company_id,
          'externalReference', purchase_order.external_reference,
          'total', purchase_order.total
        ) order by purchase_order.external_reference)
        from public.purchase_orders purchase_order
        where purchase_order.tender_round_id = p_tender_round_id
      ), '[]'::jsonb)
    );
  end if;

  select * into active_mandate from public.mandates
  where purchase_request_id = p_purchase_request_id and status = 'ACTIVE'
  for update;
  if not found or not active_mandate.auto_accept or active_mandate.auto_pay then
    raise exception 'Active automatic-order mandate not found' using errcode = '23514';
  end if;
  if active_mandate.expires_at <= now() then
    raise exception 'Mandate expired' using errcode = '23514';
  end if;

  insert into public.agent_runs (
    company_id, purchase_request_id, kind, provider, model,
    input_snapshot, output, status, created_by
  )
  select
    p_buyer_company_id, p_purchase_request_id, 'OFFER_RECOMMENDATION',
    'POLICY', 'deterministic-split-award-v2',
    jsonb_build_object('tenderRoundId', p_tender_round_id),
    p_recommendation, 'SUCCEEDED', p_actor_id
  where not exists (
    select 1 from public.agent_runs run
    where run.purchase_request_id = p_purchase_request_id
      and run.kind = 'OFFER_RECOMMENDATION'
      and run.output->>'tenderRoundId' = p_tender_round_id::text
  );

  select coalesce(sum(total), 0) into spent
  from public.purchase_orders
  where purchase_request_id = p_purchase_request_id and status = 'CREATED';

  for allocation in
    select value from jsonb_array_elements(coalesce(p_recommendation->'allocations', '[]'::jsonb))
  loop
    select
      line.*, offer.supplier_company_id, offer.id as selected_offer_id,
      offer.valid_until, offer.status as offer_status, offer.payment_terms,
      item.status as item_status
    into selected_line
    from public.offer_lines line
    join public.offers offer on offer.id = line.offer_id
    join public.purchase_request_items item on item.id = line.request_item_id
    where line.id = (allocation->>'offerLineId')::uuid
      and line.request_item_id = (allocation->>'requestItemId')::uuid
      and line.purchase_request_id = p_purchase_request_id
    for update of item;

    if not found
      or selected_line.supplier_company_id <> (allocation->>'supplierCompanyId')::uuid
      or selected_line.offer_status <> 'ACTIVE'
      or selected_line.valid_until <= now()
      or not selected_line.confirmed_stock
      or selected_line.delivery_date > locked_request.required_by
      or not (selected_line.supplier_company_id = any(active_mandate.allowed_suppliers))
    then
      raise exception 'Allocation failed policy validation' using errcode = '23514';
    end if;

    select id into existing_order_item
    from public.purchase_order_items
    where request_item_id = selected_line.request_item_id;
    if existing_order_item is not null then
      continue;
    end if;
    if spent + selected_line.total > active_mandate.maximum_total_including_fees then
      update public.purchase_request_items
      set pending_reason = 'PRESUPUESTO_INSUFICIENTE'
      where id = selected_line.request_item_id;
      continue;
    end if;

    insert into public.purchase_orders (
      purchase_request_id, tender_round_id, buyer_company_id,
      supplier_company_id, offer_id, delivery_date, payment_terms,
      external_reference
    ) values (
      p_purchase_request_id, p_tender_round_id, p_buyer_company_id,
      selected_line.supplier_company_id, selected_line.selected_offer_id,
      selected_line.delivery_date, selected_line.payment_terms,
      'PO-' || upper(substr(replace(p_tender_round_id::text, '-', ''), 1, 8)) || '-' ||
        upper(right(replace(selected_line.supplier_company_id::text, '-', ''), 6))
    )
    on conflict (tender_round_id, supplier_company_id) do update
      set delivery_date = greatest(public.purchase_orders.delivery_date, excluded.delivery_date)
    returning id into order_id;

    insert into public.purchase_order_items (
      purchase_order_id, request_item_id, offer_line_id, product_id,
      description, unit, quantity, unit_price, subtotal, taxes, shipping, total
    ) values (
      order_id, selected_line.request_item_id, selected_line.id,
      selected_line.product_id, selected_line.description, selected_line.unit,
      selected_line.quantity, selected_line.unit_price, selected_line.subtotal,
      selected_line.taxes, selected_line.shipping, selected_line.total
    ) on conflict (request_item_id) do nothing;

    if found then
      spent := spent + selected_line.total;
      update public.purchase_request_items
      set status = 'AWARDED', pending_reason = null, awarded_at = now()
      where id = selected_line.request_item_id;
    end if;
  end loop;

  for pending in
    select value from jsonb_array_elements(coalesce(p_recommendation->'pendingItems', '[]'::jsonb))
  loop
    update public.purchase_request_items
    set pending_reason = coalesce(pending->>'reason', 'SIN_COBERTURA_CONFIRMADA')
    where id = (pending->>'requestItemId')::uuid and status = 'PENDING';
  end loop;

  update public.purchase_orders purchase_order
  set subtotal = totals.subtotal,
      taxes = totals.taxes,
      shipping = totals.shipping,
      total = totals.total,
      delivery_date = totals.delivery_date
  from (
    select item.purchase_order_id,
      sum(item.subtotal) subtotal, sum(item.taxes) taxes,
      sum(item.shipping) shipping, sum(item.total) total,
      max(line.delivery_date) delivery_date
    from public.purchase_order_items item
    join public.offer_lines line on line.id = item.offer_line_id
    group by item.purchase_order_id
  ) totals
  where purchase_order.id = totals.purchase_order_id
    and purchase_order.purchase_request_id = p_purchase_request_id;

  select count(*) into pending_count from public.purchase_request_items
  where purchase_request_id = p_purchase_request_id and status = 'PENDING';

  update public.tender_rounds
  set status = case when pending_count = 0 then 'COMPLETED' else 'PARTIAL' end,
      completed_at = now()
  where id = p_tender_round_id and purchase_request_id = p_purchase_request_id;

  update public.purchase_requests
  set status = case when pending_count = 0 then 'ORDER_CREATED' else 'PARTIALLY_ORDERED' end,
      version = version + 1
  where id = p_purchase_request_id;

  update public.negotiations negotiation
  set status = case
    when exists (
      select 1 from public.purchase_orders purchase_order
      where purchase_order.tender_round_id = p_tender_round_id
        and purchase_order.supplier_company_id = negotiation.supplier_company_id
    ) then case when pending_count = 0 then 'ACCEPTED' else 'PARTIALLY_AWARDED' end
    when pending_count = 0 then 'REJECTED'
    else 'FINAL_OFFERED'
  end
  where negotiation.purchase_request_id = p_purchase_request_id;

  if pending_count = 0 then
    update public.mandates set status = 'CONSUMED'
    where id = active_mandate.id;
  end if;

  for order_row in
    select purchase_order.*, negotiation.id as negotiation_id
    from public.purchase_orders purchase_order
    join public.negotiations negotiation
      on negotiation.purchase_request_id = purchase_order.purchase_request_id
      and negotiation.supplier_company_id = purchase_order.supplier_company_id
    where purchase_order.tender_round_id = p_tender_round_id
  loop
    insert into public.negotiation_messages (
      id, negotiation_id, purchase_request_id, protocol_version, message_type,
      sender_company_id, recipient_company_id, correlation_id, sent_at,
      expires_at, idempotency_key, payload, raw_message, tender_round_id
    ) values (
      gen_random_uuid(), order_row.negotiation_id, p_purchase_request_id,
      '1.0', 'purchase_order', p_buyer_company_id,
      order_row.supplier_company_id, null, now(), null,
      'purchase-order:' || order_row.id,
      jsonb_build_object(
        'purchaseOrderId', order_row.id,
        'offerId', order_row.offer_id,
        'externalReference', order_row.external_reference
      ),
      jsonb_build_object(
        'protocolVersion', '1.0', 'type', 'purchase_order',
        'purchaseRequestId', p_purchase_request_id,
        'negotiationId', order_row.negotiation_id,
        'senderCompanyId', p_buyer_company_id,
        'recipientCompanyId', order_row.supplier_company_id,
        'tenderRoundId', p_tender_round_id,
        'payload', jsonb_build_object(
          'purchaseOrderId', order_row.id,
          'offerId', order_row.offer_id,
          'externalReference', order_row.external_reference
        )
      ),
      p_tender_round_id
    ) on conflict (sender_company_id, idempotency_key) do nothing;
  end loop;

  insert into public.domain_events (aggregate_type, aggregate_id, event_type, payload)
  values (
    'purchase_request', p_purchase_request_id,
    case when pending_count = 0 then 'purchase_request.orders_created'
      else 'purchase_request.partially_ordered' end,
    jsonb_build_object(
      'purchaseRequestId', p_purchase_request_id,
      'tenderRoundId', p_tender_round_id,
      'pendingItems', pending_count
    )
  );

  insert into public.audit_log (
    company_id, actor_type, actor_id, action, aggregate_type, aggregate_id,
    metadata
  ) values (
    p_buyer_company_id, 'AGENT', p_actor_id, 'purchase_request.split_awarded',
    'purchase_request', p_purchase_request_id,
    jsonb_build_object('tenderRoundId', p_tender_round_id, 'pendingItems', pending_count)
  );

  return jsonb_build_object(
    'status', case when pending_count = 0 then 'ORDER_CREATED' else 'PARTIALLY_ORDERED' end,
    'pendingItems', pending_count,
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'purchaseOrderId', purchase_order.id,
        'supplierCompanyId', purchase_order.supplier_company_id,
        'externalReference', purchase_order.external_reference,
        'total', purchase_order.total
      ) order by purchase_order.external_reference)
      from public.purchase_orders purchase_order
      where purchase_order.tender_round_id = p_tender_round_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.start_tender_round_command(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.record_split_award_and_orders_command(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.start_tender_round_command(uuid, uuid, text)
  to service_role;
grant execute on function public.record_split_award_and_orders_command(uuid, uuid, uuid, text, jsonb)
  to service_role;

commit;
