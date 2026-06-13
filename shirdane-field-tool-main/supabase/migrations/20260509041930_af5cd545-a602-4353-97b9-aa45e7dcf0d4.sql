
create table if not exists public.livestock_milk_records (
  id bigserial primary key,
  livestock_id bigint not null references public.cows(id) on delete cascade,
  milk_amount numeric(8,2) not null,
  record_date date not null,
  period smallint not null check (period in (1, 2, 3)),
  description text,
  registered_user_id bigint null,
  registered_at timestamp with time zone not null default now(),
  is_cancelled boolean not null default false,
  cancelled_at timestamp with time zone null,
  cancelled_user_id bigint null,
  cancel_reason text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create unique index if not exists uq_lmr_livestock_date_period_active
  on public.livestock_milk_records (livestock_id, record_date, period)
  where is_cancelled = false;

create index if not exists idx_livestock_milk_records_livestock_date
  on public.livestock_milk_records (livestock_id, record_date desc)
  where is_cancelled = false;

create index if not exists idx_livestock_milk_records_date_period
  on public.livestock_milk_records (record_date desc, period)
  where is_cancelled = false;

alter table public.livestock_milk_records enable row level security;

create policy "Allow public read livestock_milk_records" on public.livestock_milk_records for select using (true);
create policy "Allow public insert livestock_milk_records" on public.livestock_milk_records for insert with check (true);
create policy "Allow public update livestock_milk_records" on public.livestock_milk_records for update using (true);
create policy "Allow public delete livestock_milk_records" on public.livestock_milk_records for delete using (true);

create trigger update_lmr_updated_at
  before update on public.livestock_milk_records
  for each row execute function public.update_updated_at_column();

alter table public.cows
  add column if not exists last_milk_record_date text,
  add column if not exists last_milk_amount numeric,
  add column if not exists last_daily_milk_total numeric;

create or replace function public.rebuild_cow_milk_cache(p_cow_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last_date date;
  v_last_amount numeric;
  v_daily_total numeric;
begin
  select record_date, milk_amount
    into v_last_date, v_last_amount
  from public.livestock_milk_records
  where livestock_id = p_cow_id and is_cancelled = false
  order by record_date desc, period desc, registered_at desc
  limit 1;

  if v_last_date is not null then
    select coalesce(sum(milk_amount), 0)
      into v_daily_total
    from public.livestock_milk_records
    where livestock_id = p_cow_id and is_cancelled = false and record_date = v_last_date;
  else
    v_daily_total := null;
  end if;

  update public.cows
     set last_milk_record_date = case when v_last_date is null then null else v_last_date::text end,
         last_milk_amount = v_last_amount,
         last_daily_milk_total = v_daily_total
   where id = p_cow_id;
end;
$$;

create or replace function public.trg_rebuild_cow_milk_cache()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.rebuild_cow_milk_cache(old.livestock_id);
    return old;
  else
    perform public.rebuild_cow_milk_cache(new.livestock_id);
    if tg_op = 'UPDATE' and old.livestock_id is distinct from new.livestock_id then
      perform public.rebuild_cow_milk_cache(old.livestock_id);
    end if;
    return new;
  end if;
end;
$$;

drop trigger if exists trg_rebuild_cow_milk_cache on public.livestock_milk_records;
create trigger trg_rebuild_cow_milk_cache
  after insert or update or delete on public.livestock_milk_records
  for each row execute function public.trg_rebuild_cow_milk_cache();
