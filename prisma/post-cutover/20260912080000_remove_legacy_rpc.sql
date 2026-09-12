begin;

drop trigger if exists negotiation_messages_set_round on public.negotiation_messages;
drop trigger if exists offers_set_round on public.offers;
drop trigger if exists offers_normalize_lines on public.offers;
drop trigger if exists purchase_orders_set_reference on public.purchase_orders;

drop function if exists private.protocol_message_round();
drop function if exists private.offer_round();
drop function if exists private.normalize_offer_lines();
drop function if exists private.set_purchase_order_reference();

drop function if exists public.record_inventory_snapshot_command(uuid, text, text, text, text, text, text, text, numeric, numeric, numeric, timestamptz);
drop function if exists public.record_sale_command(uuid, text, text, text, text, text, text, text, text, numeric, numeric, timestamptz);
drop function if exists public.create_purchase_request_command(uuid, text, text, date, timestamptz, jsonb);
drop function if exists public.approve_purchase_request_command(uuid, uuid, text, numeric, uuid[], text, text, boolean, boolean, timestamptz);
drop function if exists public.append_protocol_message_command(jsonb, text, text);
drop function if exists public.record_agent_recommendation_command(uuid, uuid, text, text, jsonb, jsonb, text);
drop function if exists public.record_supplier_agent_run_command(uuid, uuid, text, jsonb, jsonb, text);
drop function if exists public.record_negotiation_metrics_command(uuid, uuid, uuid, integer, integer, numeric, numeric, numeric, numeric, numeric, numeric, integer);
drop function if exists public.start_tender_round_command(uuid, uuid, text);
drop function if exists public.record_split_award_and_orders_command(uuid, uuid, uuid, text, jsonb);

commit;
