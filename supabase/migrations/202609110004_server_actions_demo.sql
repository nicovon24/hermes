begin;

insert into public.purchase_requests (
  id, buyer_company_id, status, currency, required_by, expires_at,
  created_by, version
)
values (
  '00000000-0000-4000-8000-000000000601',
  '00000000-0000-4000-8000-000000000001',
  'NEGOTIATING',
  'ARS',
  current_date + 5,
  now() + interval '3 days',
  'demo-buyer',
  2
);

insert into public.purchase_request_items (
  id, purchase_request_id, product_id, description, unit,
  minimum_quantity, target_quantity, maximum_quantity
)
values (
  '00000000-0000-4000-8000-000000000611',
  '00000000-0000-4000-8000-000000000601',
  'ACEITE-1500',
  'Aceite de girasol 1,5 L',
  'unidad',
  20,
  30,
  40
);

insert into public.mandates (
  id, purchase_request_id, buyer_company_id, approved_by, version, currency,
  maximum_total_including_fees, allowed_suppliers, payment_terms,
  settlement_asset, auto_accept, auto_pay, expires_at
)
values (
  '00000000-0000-4000-8000-000000000621',
  '00000000-0000-4000-8000-000000000601',
  '00000000-0000-4000-8000-000000000001',
  'demo-buyer',
  1,
  'ARS',
  150000.00,
  array[
    '00000000-0000-4000-8000-000000000101'::uuid,
    '00000000-0000-4000-8000-000000000102'::uuid,
    '00000000-0000-4000-8000-000000000103'::uuid
  ],
  'CONTADO',
  'ARS',
  false,
  false,
  now() + interval '3 days'
);

insert into public.negotiations (
  id, purchase_request_id, buyer_company_id, supplier_company_id
)
values
  ('00000000-0000-4000-8000-000000000631', '00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000632', '00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000102'),
  ('00000000-0000-4000-8000-000000000633', '00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000103');

insert into public.domain_events (aggregate_type, aggregate_id, event_type, payload)
values (
  'purchase_request',
  '00000000-0000-4000-8000-000000000601',
  'purchase_request.demo_created',
  jsonb_build_object(
    'purchaseRequestId', '00000000-0000-4000-8000-000000000601',
    'buyerCompanyId', '00000000-0000-4000-8000-000000000001'
  )
);

commit;
