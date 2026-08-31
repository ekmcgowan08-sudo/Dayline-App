-- Minimal stand-in for the parts of Supabase's platform schema that our
-- migrations/tests reference (auth.users, auth.uid(), storage.buckets/
-- objects, storage.foldername). This is NOT a full Supabase emulation —
-- it exists purely so migrations can be run and RLS-tested against a
-- plain local Postgres 16 in this sandbox (no Docker daemon available for
-- the real `supabase start` stack). See docs/IMPLEMENTATION_STATUS.md for
-- the exact verification tier this gives us.

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  created_at timestamptz not null default now()
);

-- Session emulation: tests set this GUC per-connection to impersonate a user.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text not null,
  owner uuid,
  created_at timestamptz not null default now()
);

create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$
  select string_to_array(name, '/');
$$;

alter table storage.objects enable row level security;

-- Roles matching Supabase's PostgREST roles so `grant ... to authenticated`
-- and RLS policy role checks behave the same way here as in production.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role bypassrls;
  end if;
end $$;

grant usage on schema public, auth, storage to authenticated, anon;

-- Mirror Supabase's real default grants: broad table-level DML is granted to
-- authenticated/anon and RLS policies are the *only* thing narrowing access.
-- Without this, our tests would "pass" for the wrong reason (a bare
-- permission-denied from missing GRANTs) instead of proving RLS itself
-- blocks the operation.
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to authenticated, anon;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to authenticated, anon;
alter default privileges for role postgres in schema public
  grant execute on functions to authenticated;

-- Supabase grants broad DML on storage.objects/buckets too (RLS is what
-- actually restricts access, same as for public-schema tables above).
grant select, insert, update, delete on storage.objects, storage.buckets to authenticated, anon;
