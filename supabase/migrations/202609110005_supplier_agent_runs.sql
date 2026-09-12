begin;

create function public.record_supplier_agent_run_command(
  p_supplier_company_id uuid,
  p_purchase_request_id uuid,
  p_model text,
  p_input_snapshot jsonb,
  p_output jsonb,
  p_status text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  run_id uuid := gen_random_uuid();
begin
  insert into public.agent_runs (
    id, company_id, purchase_request_id, kind, provider, model,
    input_snapshot, output, status, created_by
  ) values (
    run_id, p_supplier_company_id, p_purchase_request_id,
    'NEGOTIATION_DRAFT', 'GROQ', p_model, p_input_snapshot, p_output,
    p_status, 'supplier-agent:' || p_supplier_company_id::text
  );

  return run_id;
end;
$$;

revoke all on function public.record_supplier_agent_run_command(uuid, uuid, text, jsonb, jsonb, text)
from public, anon, authenticated;
grant execute on function public.record_supplier_agent_run_command(uuid, uuid, text, jsonb, jsonb, text)
to service_role;

commit;
