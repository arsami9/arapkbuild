-- Supabase starter schema for the future multi-user Wevlo deployment.
-- Apply in Supabase SQL Editor. Enable RLS; never put service_role keys in browser code.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  role text not null default 'user' check (role in ('user','admin')),
  plan text not null default 'free' check (plan in ('free','pro','studio')),
  wallet_paisa bigint not null default 0 check (wallet_paisa >= 0),
  status text not null default 'active' check (status in ('active','banned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  project_type text not null default 'html',
  files jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.builds (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  app_name text not null,
  package_name text not null,
  version_name text not null default '1.0',
  status text not null default 'queued' check (status in ('queued','running','success','failed')),
  artifact_path text,
  artifact_size_bytes bigint,
  error_message text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  amount_paisa bigint not null check (amount_paisa > 0),
  currency text not null default 'BDT',
  method text not null,
  transaction_reference text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.builds enable row level security;
alter table public.payments enable row level security;
alter table public.site_settings enable row level security;

-- Users can read/update their own profile (role and plan changes must be performed by trusted server/admin functions).
drop policy if exists "profile read own" on public.profiles;
create policy "profile read own" on public.profiles for select to authenticated using (auth.uid() = id);
drop policy if exists "profile update own name" on public.profiles;
create policy "profile update own name" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
-- Column-level grants prevent users from promoting themselves to admin or changing plans/wallet/status.
revoke update on public.profiles from authenticated;
grant update (display_name, updated_at) on public.profiles to authenticated;

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile after insert on auth.users
for each row execute procedure public.handle_new_auth_user();

drop policy if exists "projects own all" on public.projects;
create policy "projects own all" on public.projects for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists "builds own read" on public.builds;
create policy "builds own read" on public.builds for select to authenticated using (auth.uid() = owner_id);
drop policy if exists "payments own read" on public.payments;
create policy "payments own read" on public.payments for select to authenticated using (auth.uid() = owner_id);
drop policy if exists "payments own create" on public.payments;
create policy "payments own create" on public.payments for insert to authenticated with check (auth.uid() = owner_id and status = 'pending');
-- Do not add browser write policies for builds, site_settings, payment approvals, roles, plans, or wallet balances.
-- Those operations must run in a trusted backend after validating the Supabase JWT and admin permissions.
