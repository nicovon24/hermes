-- Integration test for the context migration.
begin;

insert into public.companies (id, slug, legal_name, kind)
values ('00000000-0000-4000-8000-000000000003', 'context-test', 'Context Test', 'BUYER');

set local role service_role;

do $$
declare
  first_snapshot_id uuid;
  duplicate_snapshot_id uuid;
  first_sale_id uuid;
  duplicate_sale_id uuid;
begin
  select public.record_inventory_snapshot_command(
    '00000000-0000-4000-8000-000000000003',
    'context-test-actor',
    'ERP', 'erp-test', 'inventory-v1', 'SKU-1', 'Product', 'unit',
    20, 4, 6, now()
  ) into first_snapshot_id;

  select public.record_inventory_snapshot_command(
    '00000000-0000-4000-8000-000000000003',
    'context-test-actor',
    'ERP', 'erp-test', 'inventory-v1', 'SKU-1', 'Product', 'unit',
    20, 4, 6, now()
  ) into duplicate_snapshot_id;

  select public.record_sale_command(
    '00000000-0000-4000-8000-000000000003',
    'context-test-actor',
    'ERP', 'erp-test', 'sales-v1', 'ticket-1', 'SKU-1', 'Product', 'unit',
    2, 100.00, now()
  ) into first_sale_id;

  select public.record_sale_command(
    '00000000-0000-4000-8000-000000000003',
    'context-test-actor',
    'ERP', 'erp-test', 'sales-v1', 'ticket-1', 'SKU-1', 'Product', 'unit',
    2, 100.00, now()
  ) into duplicate_sale_id;

  if first_snapshot_id <> duplicate_snapshot_id then
    raise exception 'Inventory idempotency assertion failed';
  end if;
  if first_sale_id <> duplicate_sale_id then
    raise exception 'Sale idempotency assertion failed';
  end if;
  if (select count(*) from public.inventory_snapshots where company_id = '00000000-0000-4000-8000-000000000003') <> 1 then
    raise exception 'Unexpected inventory snapshot count';
  end if;
  if (select count(*) from public.sales_events where company_id = '00000000-0000-4000-8000-000000000003') <> 1 then
    raise exception 'Unexpected sale event count';
  end if;
  if (select count(*) from public.context_events where company_id = '00000000-0000-4000-8000-000000000003') <> 2 then
    raise exception 'Unexpected context event count';
  end if;
end;
$$;

rollback;
