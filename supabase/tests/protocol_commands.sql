-- Integration test for the protocol migration.
begin;

set local role service_role;

do $$
declare
  request_id uuid;
  negotiation_id uuid;
  message_result record;
  duplicate_result record;
  protocol_message jsonb;
begin
  select public.create_purchase_request_command(
    '00000000-0000-4000-8000-000000000001',
    'protocol-test-actor',
    'ARS',
    current_date + 7,
    now() + interval '1 day',
    '[{"productId":"SKU-1","description":"Product","unit":"unit","minimumQuantity":"8","targetQuantity":"10","maximumQuantity":"12"}]'::jsonb
  ) into request_id;

  perform public.approve_purchase_request_command(
    request_id,
    '00000000-0000-4000-8000-000000000001',
    'protocol-test-actor',
    1500.00,
    array['00000000-0000-4000-8000-000000000101'::uuid],
    'PREPAID',
    'ARS_TOKEN',
    false,
    false,
    now() + interval '1 day'
  );

  select id into negotiation_id
  from public.negotiations
  where purchase_request_id = request_id;

  protocol_message := jsonb_build_object(
    'messageId', '00000000-0000-4000-8000-000000000020',
    'protocolVersion', '1.0',
    'type', 'offer',
    'senderCompanyId', '00000000-0000-4000-8000-000000000101',
    'recipientCompanyId', '00000000-0000-4000-8000-000000000001',
    'purchaseRequestId', request_id,
    'negotiationId', negotiation_id,
    'correlationId', null,
    'sentAt', now(),
    'expiresAt', now() + interval '1 day',
    'idempotencyKey', 'supplier-test:offer:1',
    'payload', jsonb_build_object(
      'offerId', '00000000-0000-4000-8000-000000000030',
      'currency', 'ARS',
      'quotedAt', now(),
      'validUntil', now() + interval '1 day',
      'lines', jsonb_build_array(jsonb_build_object(
        'productId', 'SKU-1',
        'description', 'Product',
        'unit', 'unit',
        'quantity', '10',
        'unitPrice', '100.00',
        'lineTotal', '1000.00'
      )),
      'subtotal', '1000.00',
      'taxes', '210.00',
      'shipping', '0.00',
      'discount', '0.00',
      'total', '1210.00',
      'confirmedStock', true,
      'deliveryDate', current_date + 7,
      'paymentTerms', 'PREPAID',
      'notes', null
    )
  );

  select * into message_result
  from public.append_protocol_message_command(
    protocol_message,
    'INTEGRATION',
    'integration-test'
  );
  select * into duplicate_result
  from public.append_protocol_message_command(
    protocol_message,
    'INTEGRATION',
    'integration-test'
  );

  if message_result.was_duplicate or not duplicate_result.was_duplicate then
    raise exception 'Message idempotency assertion failed';
  end if;
  if (select count(*) from public.negotiation_messages where purchase_request_id = request_id) <> 1 then
    raise exception 'Unexpected message count';
  end if;
  if (select count(*) from public.offers where purchase_request_id = request_id and status = 'ACTIVE') <> 1 then
    raise exception 'Unexpected active offer count';
  end if;
  perform public.record_supplier_agent_run_command(
    '00000000-0000-4000-8000-000000000101',
    request_id,
    'test-model',
    '{"phase":"INITIAL"}'::jsonb,
    '{"unitPrice":"100.00"}'::jsonb,
    'SUCCEEDED'
  );
  perform public.record_negotiation_metrics_command(
    negotiation_id,
    request_id,
    '00000000-0000-4000-8000-000000000101',
    2,
    4,
    1250.00,
    1210.00,
    3.200,
    18.000,
    19.333,
    100,
    850
  );
  if (select count(*) from public.agent_runs where purchase_request_id = request_id and kind = 'NEGOTIATION_DRAFT') <> 1 then
    raise exception 'Unexpected supplier agent run count';
  end if;
  if (select count(*) from public.negotiation_metrics where purchase_request_id = request_id) <> 1 then
    raise exception 'Unexpected negotiation metric count';
  end if;
  if (select count(*) from public.domain_events where aggregate_id in (request_id, negotiation_id)) <> 3 then
    raise exception 'Unexpected domain event count';
  end if;
end;
$$;

rollback;
