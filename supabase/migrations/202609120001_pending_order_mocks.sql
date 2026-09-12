begin;

-- Buyer-side mock context that produces three simultaneous replenishment drafts.
-- Fixed source versions and external event IDs keep the seed idempotent.
select public.record_inventory_snapshot_command(
  '00000000-0000-4000-8000-000000000001', 'mock-pending-orders', 'ERP',
  'erp-cliente-demo', 'demo-v2-pending-yerba', 'YERBA-1000',
  'Yerba mate 1 kg', 'unidad', 8, 4, 0, now()
);
select public.record_inventory_snapshot_command(
  '00000000-0000-4000-8000-000000000001', 'mock-pending-orders', 'ERP',
  'erp-cliente-demo', 'demo-v2-pending-arroz', 'ARROZ-1000',
  'Arroz largo fino 1 kg', 'unidad', 10, 5, 0, now()
);
select public.record_inventory_snapshot_command(
  '00000000-0000-4000-8000-000000000001', 'mock-pending-orders', 'ERP',
  'erp-cliente-demo', 'demo-v2-pending-azucar', 'AZUCAR-1000',
  'Azúcar 1 kg', 'unidad', 12, 6, 0, now()
);

select public.record_sale_command(
  '00000000-0000-4000-8000-000000000001', 'mock-pending-orders', 'ERP',
  'erp-cliente-demo', 'demo-v2-yerba-sale-1', 'pending-yerba-001',
  'YERBA-1000', 'Yerba mate 1 kg', 'unidad', 24, 4250, now() - interval '1 day'
);
select public.record_sale_command(
  '00000000-0000-4000-8000-000000000001', 'mock-pending-orders', 'ERP',
  'erp-cliente-demo', 'demo-v2-yerba-sale-2', 'pending-yerba-002',
  'YERBA-1000', 'Yerba mate 1 kg', 'unidad', 22, 4250, now() - interval '9 days'
);
select public.record_sale_command(
  '00000000-0000-4000-8000-000000000001', 'mock-pending-orders', 'ERP',
  'erp-cliente-demo', 'demo-v2-yerba-sale-3', 'pending-yerba-003',
  'YERBA-1000', 'Yerba mate 1 kg', 'unidad', 20, 4200, now() - interval '18 days'
);

select public.record_sale_command(
  '00000000-0000-4000-8000-000000000001', 'mock-pending-orders', 'ERP',
  'erp-cliente-demo', 'demo-v2-arroz-sale-1', 'pending-arroz-001',
  'ARROZ-1000', 'Arroz largo fino 1 kg', 'unidad', 20, 1450, now() - interval '2 days'
);
select public.record_sale_command(
  '00000000-0000-4000-8000-000000000001', 'mock-pending-orders', 'ERP',
  'erp-cliente-demo', 'demo-v2-arroz-sale-2', 'pending-arroz-002',
  'ARROZ-1000', 'Arroz largo fino 1 kg', 'unidad', 18, 1450, now() - interval '11 days'
);
select public.record_sale_command(
  '00000000-0000-4000-8000-000000000001', 'mock-pending-orders', 'ERP',
  'erp-cliente-demo', 'demo-v2-arroz-sale-3', 'pending-arroz-003',
  'ARROZ-1000', 'Arroz largo fino 1 kg', 'unidad', 16, 1400, now() - interval '23 days'
);

select public.record_sale_command(
  '00000000-0000-4000-8000-000000000001', 'mock-pending-orders', 'ERP',
  'erp-cliente-demo', 'demo-v2-azucar-sale-1', 'pending-azucar-001',
  'AZUCAR-1000', 'Azúcar 1 kg', 'unidad', 26, 1350, now() - interval '1 day'
);
select public.record_sale_command(
  '00000000-0000-4000-8000-000000000001', 'mock-pending-orders', 'ERP',
  'erp-cliente-demo', 'demo-v2-azucar-sale-2', 'pending-azucar-002',
  'AZUCAR-1000', 'Azúcar 1 kg', 'unidad', 24, 1350, now() - interval '10 days'
);
select public.record_sale_command(
  '00000000-0000-4000-8000-000000000001', 'mock-pending-orders', 'ERP',
  'erp-cliente-demo', 'demo-v2-azucar-sale-3', 'pending-azucar-003',
  'AZUCAR-1000', 'Azúcar 1 kg', 'unidad', 20, 1300, now() - interval '20 days'
);

commit;
