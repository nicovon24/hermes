begin;

alter table public.products
add column unit_cost numeric(20, 2) not null default 0 check (unit_cost >= 0);

alter table public.sales_events
add column customer_company_id uuid references public.companies(id);

create index sales_company_customer_sold_idx
on public.sales_events (company_id, customer_company_id, sold_at desc);

create table public.company_objectives (
  company_id uuid primary key references public.companies(id) on delete cascade,
  target_stock_capital numeric(20, 2) check (target_stock_capital >= 0),
  target_days_of_stock integer check (target_days_of_stock > 0),
  target_margin_percentage numeric(8, 3) check (
    target_margin_percentage >= 0 and target_margin_percentage < 100
  ),
  target_rotation_days integer check (target_rotation_days > 0),
  updated_at timestamptz not null default now()
);

alter table public.company_objectives enable row level security;
revoke all on public.company_objectives from anon, authenticated;
grant all on public.company_objectives to service_role;

update public.products
set unit_cost = case external_id
  when 'ACEITE-1500' then 2180.00
  when 'YERBA-1000' then 2940.00
  when 'ARROZ-1000' then 980.00
  when 'AZUCAR-1000' then 870.00
end
where company_id = '00000000-0000-4000-8000-000000000001';

update public.products
set unit_cost = case
  when company_id = '00000000-0000-4000-8000-000000000101' and external_id = 'ACEITE-1500' then 2050.00
  when company_id = '00000000-0000-4000-8000-000000000102' and external_id = 'ACEITE-1500' then 1980.00
  when company_id = '00000000-0000-4000-8000-000000000103' and external_id = 'ACEITE-1500' then 2120.00
  when external_id = 'YERBA-1000' then 2700.00
  when external_id = 'ARROZ-1000' then 820.00
  when external_id = 'AZUCAR-1000' then 730.00
  else unit_cost
end
where company_id in (
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000103'
);

insert into public.company_objectives (
  company_id, target_stock_capital, target_days_of_stock,
  target_margin_percentage, target_rotation_days
)
values
  ('00000000-0000-4000-8000-000000000001', 250000.00, 14, null, null),
  ('00000000-0000-4000-8000-000000000101', null, null, 18.000, 21),
  ('00000000-0000-4000-8000-000000000102', null, null, 22.000, 30),
  ('00000000-0000-4000-8000-000000000103', null, null, 16.000, 18);

insert into public.sales_events (
  id, company_id, customer_company_id, source_id, product_id,
  external_event_id, source_version, quantity, unit_price, sold_at, observed_at
)
values
  ('00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000001', null, '00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000201', 'ticket-demo-101', 'demo-history-101', 7, 3150.00, now() - interval '7 days', now()),
  ('00000000-0000-4000-8000-000000000702', '00000000-0000-4000-8000-000000000001', null, '00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000201', 'ticket-demo-102', 'demo-history-102', 9, 3150.00, now() - interval '14 days', now()),
  ('00000000-0000-4000-8000-000000000703', '00000000-0000-4000-8000-000000000001', null, '00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000201', 'ticket-demo-103', 'demo-history-103', 6, 3100.00, now() - interval '21 days', now()),

  ('00000000-0000-4000-8000-000000000711', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000311', '00000000-0000-4000-8000-000000000211', 'north-client-101', 'demo-history-101', 24, 2760.00, now() - interval '12 days', now()),
  ('00000000-0000-4000-8000-000000000712', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000311', '00000000-0000-4000-8000-000000000211', 'north-client-102', 'demo-history-102', 20, 2710.00, now() - interval '42 days', now()),
  ('00000000-0000-4000-8000-000000000713', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000311', '00000000-0000-4000-8000-000000000211', 'north-client-103', 'demo-history-103', 18, 2680.00, now() - interval '72 days', now()),

  ('00000000-0000-4000-8000-000000000721', '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000312', '00000000-0000-4000-8000-000000000221', 'andino-client-101', 'demo-history-101', 30, 2690.00, now() - interval '18 days', now()),
  ('00000000-0000-4000-8000-000000000722', '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000312', '00000000-0000-4000-8000-000000000221', 'andino-client-102', 'demo-history-102', 26, 2670.00, now() - interval '48 days', now()),
  ('00000000-0000-4000-8000-000000000723', '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000312', '00000000-0000-4000-8000-000000000221', 'andino-client-103', 'demo-history-103', 22, 2640.00, now() - interval '78 days', now()),

  ('00000000-0000-4000-8000-000000000731', '00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000313', '00000000-0000-4000-8000-000000000231', 'sur-client-101', 'demo-history-101', 16, 2820.00, now() - interval '9 days', now()),
  ('00000000-0000-4000-8000-000000000732', '00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000313', '00000000-0000-4000-8000-000000000231', 'sur-client-102', 'demo-history-102', 14, 2790.00, now() - interval '39 days', now()),
  ('00000000-0000-4000-8000-000000000733', '00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000313', '00000000-0000-4000-8000-000000000231', 'sur-client-103', 'demo-history-103', 12, 2750.00, now() - interval '69 days', now());

commit;
