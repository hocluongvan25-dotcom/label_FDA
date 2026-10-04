-- Freeze explicit sign-off fields in every newly issued report snapshot.
-- Existing v1.0 snapshots remain immutable and are read with legacy fallbacks.
create function public.app_report_signoff_snapshot() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare
  disposition_value text;
  approved_by_value jsonb;
  rationale_value text;
begin
  disposition_value := new.snapshot->>'result';
  approved_by_value := new.snapshot#>'{reviewer,id}';
  rationale_value := new.snapshot#>>'{reviewer,comment}';

  if disposition_value is null or disposition_value not in (
    'NEEDS_CORRECTION',
    'NO_ISSUE_DETECTED_IN_SCOPE',
    'INSUFFICIENT_INFORMATION'
  ) then
    raise exception 'Report disposition is missing or invalid';
  end if;
  if coalesce(jsonb_typeof(approved_by_value), 'null') <> 'string' or
     coalesce(length(trim(rationale_value)), 0) < 10 then
    raise exception 'Reviewer identity and rationale are required for sign-off';
  end if;

  new.snapshot := jsonb_set(
    new.snapshot,
    '{disposition}',
    to_jsonb(disposition_value),
    true
  );
  new.snapshot := jsonb_set(
    new.snapshot,
    '{approved_by}',
    approved_by_value,
    true
  );
  new.snapshot := jsonb_set(
    new.snapshot,
    '{rationale}',
    to_jsonb(rationale_value),
    true
  );
  new.snapshot := jsonb_set(
    new.snapshot,
    '{schema_version}',
    '"1.1"'::jsonb,
    true
  );
  return new;
end
$$;

create trigger report_signoff_snapshot
before insert on public.reports
for each row execute function public.app_report_signoff_snapshot();

revoke all on function public.app_report_signoff_snapshot() from public,anon,authenticated;
