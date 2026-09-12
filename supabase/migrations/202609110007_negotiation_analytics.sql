begin;

create table public.negotiation_metrics (
  id uuid primary key default gen_random_uuid(),
  negotiation_id uuid not null unique references public.negotiations(id) on delete cascade,
  purchase_request_id uuid not null references public.purchase_requests(id) on delete cascade,
  supplier_company_id uuid not null references public.companies(id),
  rounds integer not null check (rounds > 0),
  message_count integer not null check (message_count > 0),
  initial_total numeric(20, 2) not null check (initial_total >= 0),
  final_total numeric(20, 2) not null check (final_total >= 0),
  price_reduction_percentage numeric(8, 3) not null,
  estimated_margin_percentage numeric(8, 3) not null,
  capital_efficiency_score numeric(8, 3) not null,
  stock_available numeric(24, 6) not null check (stock_available >= 0),
  duration_ms integer not null check (duration_ms >= 0),
  recorded_at timestamptz not null default now()
);

create index negotiation_metrics_request_idx
on public.negotiation_metrics (purchase_request_id, recorded_at desc);

alter table public.negotiation_metrics enable row level security;
revoke all on public.negotiation_metrics from anon, authenticated;
grant all on public.negotiation_metrics to service_role;

create function public.record_negotiation_metrics_command(
  p_negotiation_id uuid,
  p_purchase_request_id uuid,
  p_supplier_company_id uuid,
  p_rounds integer,
  p_message_count integer,
  p_initial_total numeric,
  p_final_total numeric,
  p_price_reduction_percentage numeric,
  p_estimated_margin_percentage numeric,
  p_capital_efficiency_score numeric,
  p_stock_available numeric,
  p_duration_ms integer
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  metric_id uuid;
begin
  insert into public.negotiation_metrics (
    negotiation_id, purchase_request_id, supplier_company_id, rounds,
    message_count, initial_total, final_total, price_reduction_percentage,
    estimated_margin_percentage, capital_efficiency_score, stock_available,
    duration_ms
  ) values (
    p_negotiation_id, p_purchase_request_id, p_supplier_company_id, p_rounds,
    p_message_count, p_initial_total, p_final_total,
    p_price_reduction_percentage, p_estimated_margin_percentage,
    p_capital_efficiency_score, p_stock_available, p_duration_ms
  )
  on conflict (negotiation_id) do update set
    rounds = excluded.rounds,
    message_count = excluded.message_count,
    initial_total = excluded.initial_total,
    final_total = excluded.final_total,
    price_reduction_percentage = excluded.price_reduction_percentage,
    estimated_margin_percentage = excluded.estimated_margin_percentage,
    capital_efficiency_score = excluded.capital_efficiency_score,
    stock_available = excluded.stock_available,
    duration_ms = excluded.duration_ms,
    recorded_at = now()
  returning id into metric_id;

  return metric_id;
end;
$$;

revoke all on function public.record_negotiation_metrics_command(
  uuid, uuid, uuid, integer, integer, numeric, numeric, numeric, numeric,
  numeric, numeric, integer
) from public, anon, authenticated;
grant execute on function public.record_negotiation_metrics_command(
  uuid, uuid, uuid, integer, integer, numeric, numeric, numeric, numeric,
  numeric, numeric, integer
) to service_role;

commit;
