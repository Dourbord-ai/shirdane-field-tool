drop function if exists public.finance_list_settlement_items_v1(int, text, text, uuid, timestamptz, timestamptz, text, int, int);

create or replace function public.finance_list_settlement_items_v1(
  p_type_code        int         default null,
  p_status           text        default null,
  p_payment_status   text        default null,
  p_requester        uuid        default null,
  p_date_from        timestamptz default null,
  p_date_to          timestamptz default null,
  p_search           text        default null,
  p_limit            int         default 50,
  p_offset           int         default 0
)
returns table (
  item_id                  uuid,
  payment_request_id       uuid,
  party_id                 uuid,
  amount                   numeric,
  paid_amount              numeric,
  remaining_amount         numeric,
  amount_type_code         int,
  settlement_subject_type  text,
  payment_method           text,
  execution_status         text,
  voucher_id               uuid,
  description              text,
  request_legacy_id        bigint,
  request_status           text,
  request_payment_status   text,
  request_title            text,
  request_description      text,
  request_created_at       timestamptz,
  request_requested_by     uuid,
  request_legacy_type_code int,
  request_source_factor_id uuid,
  request_total_amount     numeric,
  party_first_name         text,
  party_last_name          text,
  party_company_name       text,
  party_ownership_type     text,
  party_balance            numeric,
  invoice_number           text,
  request_has_voucher      boolean,
  total_count              bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    i.id,
    i.payment_request_id,
    i.party_id,
    i.amount,
    i.paid_amount,
    i.remaining_amount,
    i.amount_type_code,
    i.settlement_subject_type,
    i.payment_method,
    i.execution_status,
    i.voucher_id,
    i.description,
    r.legacy_id,
    r.status,
    r.payment_status,
    r.title,
    r.description,
    r.created_at,
    r.requested_by,
    r.legacy_request_type_code,
    r.source_factor_id,
    r.total_amount,
    p.first_name,
    p.last_name,
    p.company_name,
    p.ownership_type,
    p.balance,
    f.invoice_number,
    exists (
      select 1
      from finance_payment_request_items v
      where v.payment_request_id = r.id
        and v.voucher_id is not null
    ) as request_has_voucher,
    count(*) over () as total_count
  from finance_payment_request_items i
  join finance_payment_requests r on r.id = i.payment_request_id
  left join finance_parties p on p.id = i.party_id
  left join factors        f on f.id = r.source_factor_id
  where r.is_deleted = false
    and i.is_deleted is not true
    and (p_type_code      is null or r.legacy_request_type_code = p_type_code)
    and (p_status         is null or r.status         = p_status)
    and (p_payment_status is null or r.payment_status = p_payment_status)
    and (p_requester      is null or r.requested_by   = p_requester)
    and (p_date_from      is null or r.created_at    >= p_date_from)
    and (p_date_to        is null or r.created_at    <= p_date_to)
    and (
      p_search is null
      or r.title ilike '%' || p_search || '%'
      or coalesce(p.company_name, trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '') ilike '%' || p_search || '%'
      or coalesce(f.invoice_number, '') ilike '%' || p_search || '%'
    )
  order by r.created_at desc, i.id asc
  limit  p_limit
  offset p_offset;
$$;

revoke all on function public.finance_list_settlement_items_v1(int, text, text, uuid, timestamptz, timestamptz, text, int, int) from public;
grant execute on function public.finance_list_settlement_items_v1(int, text, text, uuid, timestamptz, timestamptz, text, int, int) to authenticated, service_role;