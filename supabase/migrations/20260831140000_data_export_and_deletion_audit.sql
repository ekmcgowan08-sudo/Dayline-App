-- Data export requests (audited intent; fulfillment is a manual/ops step
-- documented in docs/PRIVACY_DATA_FLOW.md for this beta — no email-sending
-- infrastructure exists in this build) and a standalone account-deletion
-- audit log that survives the user row itself being deleted, so "we
-- actually deleted this account" remains provable after the fact without
-- keeping any of the deleted person's data around.

create table if not exists data_export_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'fulfilled')),
  fulfilled_at timestamptz
);
alter table data_export_requests enable row level security;
create policy "read own export requests" on data_export_requests for select using (auth.uid() = user_id);

create or replace function request_data_export() returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into data_export_requests (user_id) values (auth.uid());
end;
$$;
revoke all on function request_data_export() from public;
grant execute on function request_data_export() to authenticated;

-- No foreign key to auth.users on purpose: this row must outlive the
-- deleted account so deletion remains provable. Contains no personal data.
create table if not exists account_deletion_audit (
  id uuid primary key default gen_random_uuid(),
  deleted_user_id uuid not null,
  requested_at timestamptz,
  completed_at timestamptz not null default now()
);
alter table account_deletion_audit enable row level security;
-- No client policies at all: written only by the delete-account Edge
-- Function (service role) after a successful deletion.
