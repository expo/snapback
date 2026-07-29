alter table public.issues
  add column estimate_points integer not null default 0
  check (estimate_points between 0 and 100);

create index issues_organization_estimate_idx
  on public.issues (organization_id, estimate_points, issue_number);
