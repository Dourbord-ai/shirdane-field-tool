
-- Table
create table if not exists public.livestock_physical_statuses (
  id bigserial primary key,
  livestock_id bigint not null references public.cows(id) on delete cascade,
  stature integer null,
  weight integer null,
  body_score integer null,
  legs_score integer null,
  feet_score integer null,
  udder_height integer null,
  teat_height integer null,
  brisket integer null,
  back integer null,
  tails_head integer null,
  record_date text not null,
  description text null,
  image_path text null,
  image_url text null,
  registered_user_id uuid null,
  registered_at timestamp with time zone not null default now(),
  is_cancelled boolean not null default false,
  cancelled_at timestamp with time zone null,
  cancelled_user_id uuid null,
  cancel_reason text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists idx_lps_livestock_date
  on public.livestock_physical_statuses (livestock_id, record_date desc)
  where is_cancelled = false;

create index if not exists idx_lps_weight
  on public.livestock_physical_statuses (weight)
  where is_cancelled = false;

alter table public.livestock_physical_statuses enable row level security;

create policy "Allow public read lps" on public.livestock_physical_statuses for select using (true);
create policy "Allow public insert lps" on public.livestock_physical_statuses for insert with check (true);
create policy "Allow public update lps" on public.livestock_physical_statuses for update using (true);
create policy "Allow public delete lps" on public.livestock_physical_statuses for delete using (true);

create trigger lps_set_updated_at before update on public.livestock_physical_statuses
  for each row execute function public.update_updated_at_column();

-- Cow cache column
alter table public.cows add column if not exists last_physical_status_date text;

-- Rebuild + trigger
create or replace function public.rebuild_cow_physical_cache(p_cow_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v_weight integer; v_date text;
begin
  select weight, record_date into v_weight, v_date
    from public.livestock_physical_statuses
    where livestock_id = p_cow_id and is_cancelled = false
    order by record_date desc nulls last, created_at desc
    limit 1;
  update public.cows set
    current_live_weight = coalesce(v_weight, current_live_weight),
    last_physical_status_date = v_date,
    updated_at = now()
  where id = p_cow_id;
end;$$;

create or replace function public.trg_rebuild_cow_physical_cache()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.rebuild_cow_physical_cache(old.livestock_id); return old;
  else
    perform public.rebuild_cow_physical_cache(new.livestock_id);
    if tg_op='UPDATE' and old.livestock_id is distinct from new.livestock_id then
      perform public.rebuild_cow_physical_cache(old.livestock_id);
    end if;
    return new;
  end if;
end;$$;

drop trigger if exists lps_rebuild_cache on public.livestock_physical_statuses;
create trigger lps_rebuild_cache after insert or update or delete on public.livestock_physical_statuses
  for each row execute function public.trg_rebuild_cow_physical_cache();

-- Storage bucket
insert into storage.buckets (id, name, public)
  values ('livestock-physical-status-images', 'livestock-physical-status-images', true)
  on conflict (id) do nothing;

create policy "Public read lps images"
  on storage.objects for select
  using (bucket_id = 'livestock-physical-status-images');

create policy "Public upload lps images"
  on storage.objects for insert
  with check (bucket_id = 'livestock-physical-status-images');

create policy "Public update lps images"
  on storage.objects for update
  using (bucket_id = 'livestock-physical-status-images');

create policy "Public delete lps images"
  on storage.objects for delete
  using (bucket_id = 'livestock-physical-status-images');
