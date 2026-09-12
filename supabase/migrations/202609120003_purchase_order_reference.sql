begin;

-- The demo UUIDs share a zero prefix. Build the human reference from the
-- supplier suffix so one tender round can safely create several orders.
create function private.set_purchase_order_reference()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.external_reference :=
    'PO-' || upper(substr(replace(new.tender_round_id::text, '-', ''), 1, 8)) || '-' ||
    upper(right(replace(new.supplier_company_id::text, '-', ''), 6));
  return new;
end;
$$;

create trigger purchase_orders_set_reference
before insert on public.purchase_orders
for each row execute function private.set_purchase_order_reference();

commit;
