begin;

create extension if not exists pgcrypto;
create schema if not exists private;

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  legal_name text not null,
  kind text not null check (kind in ('BUYER', 'SUPPLIER', 'BOTH')),
  created_at timestamptz not null default now()
);

create table public.context_sources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (kind in ('ERP', 'MANUAL', 'EXTERNAL_API')),
  external_id text not null,
  last_version text not null,
  last_observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, external_id)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  external_id text not null,
  name text not null,
  unit text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, external_id)
);

create table public.inventory_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_id uuid not null references public.context_sources(id),
  product_id uuid not null references public.products(id),
  source_version text not null,
  on_hand numeric(24, 6) not null check (on_hand >= 0),
  reserved numeric(24, 6) not null check (reserved >= 0),
  in_transit numeric(24, 6) not null check (in_transit >= 0),
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (source_id, product_id, source_version)
);

create table public.sales_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_id uuid not null references public.context_sources(id),
  product_id uuid not null references public.products(id),
  external_event_id text not null,
  source_version text not null,
  quantity numeric(24, 6) not null check (quantity > 0),
  unit_price numeric(20, 2) not null check (unit_price >= 0),
  sold_at timestamptz not null,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (source_id, external_event_id)
);

create table public.context_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  event_type text not null check (event_type in ('inventory.updated', 'sale.completed')),
  aggregate_id uuid not null,
  source_id uuid not null references public.context_sources(id),
  payload jsonb not null,
  occurred_at timestamptz not null default now()
);

create index inventory_company_observed_idx
  on public.inventory_snapshots (company_id, observed_at desc);
create index inventory_product_observed_idx
  on public.inventory_snapshots (product_id, observed_at desc);
create index sales_company_sold_idx
  on public.sales_events (company_id, sold_at desc);
create index sales_product_sold_idx
  on public.sales_events (product_id, sold_at desc);
create index context_events_company_idx
  on public.context_events (company_id, occurred_at desc);

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger context_sources_set_updated_at
before update on public.context_sources
for each row execute function private.set_updated_at();

create trigger products_set_updated_at
before update on public.products
for each row execute function private.set_updated_at();

alter table public.companies enable row level security;
alter table public.context_sources enable row level security;
alter table public.products enable row level security;
alter table public.inventory_snapshots enable row level security;
alter table public.sales_events enable row level security;
alter table public.context_events enable row level security;

revoke all on public.companies, public.context_sources,
  public.products, public.inventory_snapshots, public.sales_events,
  public.context_events
from anon, authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;

create function public.record_inventory_snapshot_command(
  p_company_id uuid,
  p_actor_id text,
  p_source_kind text,
  p_source_external_id text,
  p_source_version text,
  p_product_external_id text,
  p_product_name text,
  p_unit text,
  p_on_hand numeric,
  p_reserved numeric,
  p_in_transit numeric,
  p_observed_at timestamptz
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  context_source_id uuid;
  context_product_id uuid;
  snapshot_id uuid;
begin
  insert into public.context_sources (
    company_id, kind, external_id, last_version, last_observed_at
  ) values (
    p_company_id, p_source_kind, p_source_external_id, p_source_version, p_observed_at
  )
  on conflict (company_id, external_id) do update
  set kind = excluded.kind,
      last_version = excluded.last_version,
      last_observed_at = greatest(public.context_sources.last_observed_at, excluded.last_observed_at)
  returning id into context_source_id;

  insert into public.products (company_id, external_id, name, unit)
  values (p_company_id, p_product_external_id, p_product_name, p_unit)
  on conflict (company_id, external_id) do update
  set name = excluded.name, unit = excluded.unit
  returning id into context_product_id;

  insert into public.inventory_snapshots (
    company_id, source_id, product_id, source_version,
    on_hand, reserved, in_transit, observed_at
  ) values (
    p_company_id, context_source_id, context_product_id, p_source_version,
    p_on_hand, p_reserved, p_in_transit, p_observed_at
  )
  on conflict (source_id, product_id, source_version) do nothing
  returning id into snapshot_id;

  if snapshot_id is null then
    select id into snapshot_id
    from public.inventory_snapshots
    where source_id = context_source_id
      and product_id = context_product_id
      and source_version = p_source_version;
    return snapshot_id;
  end if;

  insert into public.context_events (
    company_id, event_type, aggregate_id, source_id, payload
  ) values (
    p_company_id, 'inventory.updated', snapshot_id, context_source_id,
    jsonb_build_object(
      'snapshotId', snapshot_id,
      'productId', context_product_id,
      'sourceVersion', p_source_version,
      'actorId', p_actor_id
    )
  );

  return snapshot_id;
end;
$$;

create function public.record_sale_command(
  p_company_id uuid,
  p_actor_id text,
  p_source_kind text,
  p_source_external_id text,
  p_source_version text,
  p_external_event_id text,
  p_product_external_id text,
  p_product_name text,
  p_unit text,
  p_quantity numeric,
  p_unit_price numeric,
  p_sold_at timestamptz
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  context_source_id uuid;
  context_product_id uuid;
  sale_id uuid;
begin
  insert into public.context_sources (
    company_id, kind, external_id, last_version, last_observed_at
  ) values (
    p_company_id, p_source_kind, p_source_external_id, p_source_version, p_sold_at
  )
  on conflict (company_id, external_id) do update
  set kind = excluded.kind,
      last_version = excluded.last_version,
      last_observed_at = greatest(public.context_sources.last_observed_at, excluded.last_observed_at)
  returning id into context_source_id;

  insert into public.products (company_id, external_id, name, unit)
  values (p_company_id, p_product_external_id, p_product_name, p_unit)
  on conflict (company_id, external_id) do update
  set name = excluded.name, unit = excluded.unit
  returning id into context_product_id;

  insert into public.sales_events (
    company_id, source_id, product_id, external_event_id, source_version,
    quantity, unit_price, sold_at, observed_at
  ) values (
    p_company_id, context_source_id, context_product_id, p_external_event_id,
    p_source_version, p_quantity, p_unit_price, p_sold_at, now()
  )
  on conflict (source_id, external_event_id) do nothing
  returning id into sale_id;

  if sale_id is null then
    select id into sale_id
    from public.sales_events
    where source_id = context_source_id
      and external_event_id = p_external_event_id;
    return sale_id;
  end if;

  insert into public.context_events (
    company_id, event_type, aggregate_id, source_id, payload
  ) values (
    p_company_id, 'sale.completed', sale_id, context_source_id,
    jsonb_build_object(
      'saleId', sale_id,
      'productId', context_product_id,
      'sourceVersion', p_source_version,
      'actorId', p_actor_id
    )
  );

  return sale_id;
end;
$$;

revoke all on function public.record_inventory_snapshot_command(uuid, text, text, text, text, text, text, text, numeric, numeric, numeric, timestamptz) from public, anon, authenticated;
revoke all on function public.record_sale_command(uuid, text, text, text, text, text, text, text, text, numeric, numeric, timestamptz) from public, anon, authenticated;
grant execute on function public.record_inventory_snapshot_command(uuid, text, text, text, text, text, text, text, numeric, numeric, numeric, timestamptz) to service_role;
grant execute on function public.record_sale_command(uuid, text, text, text, text, text, text, text, text, numeric, numeric, timestamptz) to service_role;

commit;
