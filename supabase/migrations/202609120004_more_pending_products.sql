begin;

-- Three additional SKUs keep a consolidated replenishment draft visible even
-- after the acceptance-order example has been executed.
select public.record_inventory_snapshot_command(
  '00000000-0000-4000-8000-000000000001', 'workspace-pending-v4', 'ERP',
  'erp-cliente-demo', 'pending-v4-fideos', 'FIDEOS-500',
  'Fideos secos 500 g', 'unidad', 5, 2, 0, now()
);
select public.record_inventory_snapshot_command(
  '00000000-0000-4000-8000-000000000001', 'workspace-pending-v4', 'ERP',
  'erp-cliente-demo', 'pending-v4-harina', 'HARINA-1000',
  'Harina 000 1 kg', 'unidad', 7, 3, 0, now()
);
select public.record_inventory_snapshot_command(
  '00000000-0000-4000-8000-000000000001', 'workspace-pending-v4', 'ERP',
  'erp-cliente-demo', 'pending-v4-leche', 'LECHE-1000',
  'Leche larga vida 1 L', 'unidad', 4, 2, 0, now()
);

select public.record_inventory_snapshot_command(
  '00000000-0000-4000-8000-000000000101', 'workspace-pending-v4', 'ERP',
  'erp-distribuidora-norte', 'pending-v4-norte-fideos', 'FIDEOS-500',
  'Fideos secos 500 g', 'unidad', 130, 20, 40, now()
);
select public.record_inventory_snapshot_command(
  '00000000-0000-4000-8000-000000000101', 'workspace-pending-v4', 'ERP',
  'erp-distribuidora-norte', 'pending-v4-norte-harina', 'HARINA-1000',
  'Harina 000 1 kg', 'unidad', 15, 8, 20, now()
);
select public.record_inventory_snapshot_command(
  '00000000-0000-4000-8000-000000000101', 'workspace-pending-v4', 'ERP',
  'erp-distribuidora-norte', 'pending-v4-norte-leche', 'LECHE-1000',
  'Leche larga vida 1 L', 'unidad', 140, 25, 50, now()
);

select public.record_inventory_snapshot_command(
  '00000000-0000-4000-8000-000000000102', 'workspace-pending-v4', 'ERP',
  'erp-mayorista-andino', 'pending-v4-andino-fideos', 'FIDEOS-500',
  'Fideos secos 500 g', 'unidad', 15, 8, 25, now()
);
select public.record_inventory_snapshot_command(
  '00000000-0000-4000-8000-000000000102', 'workspace-pending-v4', 'ERP',
  'erp-mayorista-andino', 'pending-v4-andino-harina', 'HARINA-1000',
  'Harina 000 1 kg', 'unidad', 125, 15, 60, now()
);
select public.record_inventory_snapshot_command(
  '00000000-0000-4000-8000-000000000102', 'workspace-pending-v4', 'ERP',
  'erp-mayorista-andino', 'pending-v4-andino-leche', 'LECHE-1000',
  'Leche larga vida 1 L', 'unidad', 120, 20, 45, now()
);

select public.record_inventory_snapshot_command(
  '00000000-0000-4000-8000-000000000103', 'workspace-pending-v4', 'ERP',
  'erp-abastecimientos-sur', 'pending-v4-sur-fideos', 'FIDEOS-500',
  'Fideos secos 500 g', 'unidad', 160, 30, 70, now()
);
select public.record_inventory_snapshot_command(
  '00000000-0000-4000-8000-000000000103', 'workspace-pending-v4', 'ERP',
  'erp-abastecimientos-sur', 'pending-v4-sur-harina', 'HARINA-1000',
  'Harina 000 1 kg', 'unidad', 150, 20, 65, now()
);
select public.record_inventory_snapshot_command(
  '00000000-0000-4000-8000-000000000103', 'workspace-pending-v4', 'ERP',
  'erp-abastecimientos-sur', 'pending-v4-sur-leche', 'LECHE-1000',
  'Leche larga vida 1 L', 'unidad', 12, 8, 20, now()
);

select public.record_sale_command(
  '00000000-0000-4000-8000-000000000001', 'workspace-pending-v4', 'ERP',
  'erp-cliente-demo', 'pending-v4-fideos-sale-1', 'pending-v4-fideos-1',
  'FIDEOS-500', 'Fideos secos 500 g', 'unidad', 24, 1200, now() - interval '3 days'
);
select public.record_sale_command(
  '00000000-0000-4000-8000-000000000001', 'workspace-pending-v4', 'ERP',
  'erp-cliente-demo', 'pending-v4-fideos-sale-2', 'pending-v4-fideos-2',
  'FIDEOS-500', 'Fideos secos 500 g', 'unidad', 21, 1200, now() - interval '14 days'
);
select public.record_sale_command(
  '00000000-0000-4000-8000-000000000001', 'workspace-pending-v4', 'ERP',
  'erp-cliente-demo', 'pending-v4-harina-sale-1', 'pending-v4-harina-1',
  'HARINA-1000', 'Harina 000 1 kg', 'unidad', 32, 1100, now() - interval '4 days'
);
select public.record_sale_command(
  '00000000-0000-4000-8000-000000000001', 'workspace-pending-v4', 'ERP',
  'erp-cliente-demo', 'pending-v4-harina-sale-2', 'pending-v4-harina-2',
  'HARINA-1000', 'Harina 000 1 kg', 'unidad', 28, 1100, now() - interval '17 days'
);
select public.record_sale_command(
  '00000000-0000-4000-8000-000000000001', 'workspace-pending-v4', 'ERP',
  'erp-cliente-demo', 'pending-v4-leche-sale-1', 'pending-v4-leche-1',
  'LECHE-1000', 'Leche larga vida 1 L', 'unidad', 48, 1750, now() - interval '2 days'
);
select public.record_sale_command(
  '00000000-0000-4000-8000-000000000001', 'workspace-pending-v4', 'ERP',
  'erp-cliente-demo', 'pending-v4-leche-sale-2', 'pending-v4-leche-2',
  'LECHE-1000', 'Leche larga vida 1 L', 'unidad', 42, 1750, now() - interval '13 days'
);

update public.products
set unit_cost = case external_id
  when 'FIDEOS-500' then 800
  when 'HARINA-1000' then 700
  when 'LECHE-1000' then 1200
end
where company_id = '00000000-0000-4000-8000-000000000001'
  and external_id in ('FIDEOS-500', 'HARINA-1000', 'LECHE-1000');

update public.products set unit_cost = case
  when company_id = '00000000-0000-4000-8000-000000000101' and external_id = 'FIDEOS-500' then 600
  when company_id = '00000000-0000-4000-8000-000000000101' and external_id = 'HARINA-1000' then 520
  when company_id = '00000000-0000-4000-8000-000000000101' and external_id = 'LECHE-1000' then 900
  when company_id = '00000000-0000-4000-8000-000000000102' and external_id = 'FIDEOS-500' then 580
  when company_id = '00000000-0000-4000-8000-000000000102' and external_id = 'HARINA-1000' then 500
  when company_id = '00000000-0000-4000-8000-000000000102' and external_id = 'LECHE-1000' then 920
  when company_id = '00000000-0000-4000-8000-000000000103' and external_id = 'FIDEOS-500' then 550
  when company_id = '00000000-0000-4000-8000-000000000103' and external_id = 'HARINA-1000' then 540
  when company_id = '00000000-0000-4000-8000-000000000103' and external_id = 'LECHE-1000' then 950
end
where company_id in (
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000103'
)
and external_id in ('FIDEOS-500', 'HARINA-1000', 'LECHE-1000');

commit;
