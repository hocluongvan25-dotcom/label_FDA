-- Versioned risk triage. Final reports remain reviewer-approved in public.reports.
begin;

create type public.triage_route as enum (
  'OUT_OF_SCOPE',
  'BLOCKED_REGULATORY_SOURCE',
  'EXPERT_REVIEW_REQUIRED',
  'NEEDS_CUSTOMER_INFORMATION',
  'AUTO_SCREENED'
);
create type public.triage_overall_result as enum (
  'NOT_ASSESSED',
  'NO_AUTOMATED_ISSUE_DETECTED',
  'POTENTIAL_ISSUES_FOUND',
  'NO_ISSUE_DETECTED_IN_SCOPE',
  'NEEDS_CORRECTION',
  'INSUFFICIENT_INFORMATION',
  'BLOCKED',
  'OUT_OF_SCOPE'
);
create type public.triage_report_status as enum (
  'NOT_ISSUED',
  'BLOCKED',
  'DISABLED',
  'PRE_SCREENING_ISSUED',
  'FINAL_REPORT_ISSUED'
);
create type public.expert_review_status as enum (
  'NOT_REQUIRED',
  'PENDING',
  'IN_PROGRESS',
  'EXPERT_REVIEWED'
);

alter table public.reviews
  add column triage_route public.triage_route not null default 'EXPERT_REVIEW_REQUIRED',
  add column overall_result public.triage_overall_result not null default 'NOT_ASSESSED',
  add column report_status public.triage_report_status not null default 'NOT_ISSUED',
  add column expert_review_status public.expert_review_status not null default 'PENDING',
  add column triage_reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(triage_reasons)='array'),
  add column triage_risk_score integer not null default 0 check (triage_risk_score between 0 and 100),
  add column triage_policy_version text not null default 'risk-based-triage/1.0.0' check (length(triage_policy_version) between 1 and 100),
  add column triage_evaluated_at timestamptz;

update public.reviews r
set report_status='FINAL_REPORT_ISSUED',
    expert_review_status='EXPERT_REVIEWED',
    overall_result=case (
      select p.snapshot->>'result'
      from public.reports p
      where p.review_id=r.id
      order by p.created_at desc
      limit 1
    )
      when 'NEEDS_CORRECTION' then 'NEEDS_CORRECTION'::public.triage_overall_result
      when 'NO_ISSUE_DETECTED_IN_SCOPE' then 'NO_ISSUE_DETECTED_IN_SCOPE'::public.triage_overall_result
      when 'INSUFFICIENT_INFORMATION' then 'INSUFFICIENT_INFORMATION'::public.triage_overall_result
      else r.overall_result
    end
where exists(select 1 from public.reports p where p.review_id=r.id);

create index reviews_triage_route on public.reviews(organization_id,triage_route,updated_at desc);

-- Disease-claim detection is a triage signal, not a legal-violation rule.
-- Refresh only unpublished drafts; published rule definitions remain immutable.
update public.compliance_rules
set action_json=jsonb_build_object(
      'severity','information',
      'human_review',true,
      'suggested_action','Chuyển chuyên gia phân loại claim; không kết luận vi phạm hoặc yêu cầu sửa chỉ từ tín hiệu từ khóa.'
    ),
    test_status='pending',test_hash=null,test_source_snapshot=null,updated_at=now()
where rule_key='CLAIM-001' and status='DRAFT'
  and action_json is distinct from jsonb_build_object(
      'severity','information',
      'human_review',true,
      'suggested_action','Chuyển chuyên gia phân loại claim; không kết luận vi phạm hoặc yêu cầu sửa chỉ từ tín hiệu từ khóa.'
    );

-- Append-only decision history keeps route, outcome, lifecycle, and artifact state distinct.
create table public.review_triage_runs (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null,
  organization_id uuid not null,
  policy_version text not null check(length(policy_version) between 1 and 100),
  triage_route public.triage_route not null,
  overall_result public.triage_overall_result not null,
  risk_score integer not null check(risk_score between 0 and 100),
  reasons jsonb not null check(jsonb_typeof(reasons)='array'),
  customer_questions jsonb not null default '[]'::jsonb check(jsonb_typeof(customer_questions)='array'),
  expert_review_status public.expert_review_status not null,
  report_status public.triage_report_status not null,
  rule_snapshot jsonb not null default '[]'::jsonb check(jsonb_typeof(rule_snapshot)='array'),
  evaluated_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key(review_id,organization_id) references public.reviews(id,organization_id)
);
create index review_triage_runs_review on public.review_triage_runs(review_id,created_at desc);

create table public.pre_screening_reports (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null,
  organization_id uuid not null,
  product_id uuid not null,
  label_version_id uuid not null,
  triage_run_id uuid not null references public.review_triage_runs(id),
  version integer not null check(version>0),
  disclaimer_profile text not null check(disclaimer_profile='PRE_SCREENING_ONLY'),
  snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
  created_at timestamptz not null default now(),
  foreign key(review_id,organization_id) references public.reviews(id,organization_id),
  foreign key(label_version_id,organization_id,product_id) references public.label_versions(id,organization_id,product_id),
  unique(review_id,version)
);
create index pre_screening_reports_org on public.pre_screening_reports(organization_id,created_at desc);

create function public.app_triage_append_only() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  raise exception 'Triage history and pre-screening artifacts are append-only';
end
$$;
create trigger triage_run_no_mutation before update or delete on public.review_triage_runs
  for each row execute function public.app_triage_append_only();
create trigger pre_screening_report_no_mutation before update or delete on public.pre_screening_reports
  for each row execute function public.app_triage_append_only();

create function public.app_validate_pre_screening_snapshot() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare body text;
begin
  if new.disclaimer_profile <> 'PRE_SCREENING_ONLY'
     or new.snapshot->>'disclaimer_profile' <> 'PRE_SCREENING_ONLY'
     or new.snapshot->>'triage_route' <> 'AUTO_SCREENED' then
    raise exception 'Invalid pre-screening artifact profile or route';
  end if;
  body:=jsonb_pretty(new.snapshot);
  if body ~* '(FDA[[:space:]]+(approved|compliant)|được[[:space:]]+phép[[:space:]]+xuất[[:space:]]+khẩu|được[[:space:]]+FDA[[:space:]]+phê[[:space:]]+duyệt)' then
    raise exception 'Pre-screening artifact contains prohibited wording';
  end if;
  return new;
end
$$;
create trigger pre_screening_language_guard before insert on public.pre_screening_reports
  for each row execute function public.app_validate_pre_screening_snapshot();

-- Defaults are intentionally disabled. Activation requires both this staging allowlist
-- and a separate worker runtime setting; production is never inferred as staging.
create table public.triage_feature_flags (
  singleton boolean primary key default true check(singleton),
  pre_screening_enabled boolean not null default false,
  deployment_environment text not null default 'disabled' check(deployment_environment in ('disabled','staging')),
  allowed_organization_ids uuid[] not null default '{}',
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  check(pre_screening_enabled=false or (deployment_environment='staging' and cardinality(allowed_organization_ids) between 1 and 20))
);
insert into public.triage_feature_flags(singleton,pre_screening_enabled,deployment_environment,allowed_organization_ids)
values(true,false,'disabled','{}');
alter table public.triage_feature_flags enable row level security;
revoke all on public.triage_feature_flags from anon,authenticated;
grant all on public.triage_feature_flags to service_role;

create function public.vexim_pre_screening_allowed(p_organization_id uuid) returns boolean
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  perform public.app_require_service();
  return exists(
    select 1 from public.triage_feature_flags f
    where f.singleton
      and f.pre_screening_enabled
      and f.deployment_environment='staging'
      and p_organization_id=any(f.allowed_organization_ids)
  );
end
$$;

create function public.vexim_set_triage_pre_screening(
  p_enabled boolean,
  p_environment text,
  p_organization_ids jsonb
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare allowlist uuid[];
begin
  perform public.app_require_staff('system_admin');
  if jsonb_typeof(p_organization_ids)<>'array' or jsonb_array_length(p_organization_ids)>20 then
    raise exception 'Organization allowlist must be a JSON array of at most 20 ids';
  end if;
  allowlist:=array(select distinct jsonb_array_elements_text(p_organization_ids)::uuid);
  if p_enabled then
    if p_environment<>'staging' or cardinality(allowlist) not between 1 and 20 then
      raise exception 'Pre-screening can only be allowlisted for staging organizations';
    end if;
  elsif p_environment not in ('disabled','staging') then
    raise exception 'Unsupported triage deployment environment';
  end if;
  update public.triage_feature_flags
  set pre_screening_enabled=p_enabled,
      deployment_environment=case when p_enabled then 'staging' else p_environment end,
      allowed_organization_ids=case when p_enabled then allowlist else '{}'::uuid[] end,
      updated_by=auth.uid(),updated_at=now()
  where singleton;
  perform public.app_write_audit(null,'triage.pre_screening_flag_changed','triage_config','staging',
    case when p_enabled then 'Enabled allowlisted staging pre-screening' else 'Disabled pre-screening' end,
    jsonb_build_object('enabled',p_enabled,'environment',p_environment,'organization_count',cardinality(allowlist)));
end
$$;

-- A manual move from triage/customer follow-up into the reviewer workflow is a lifecycle change.
create function public.app_triage_expert_lifecycle() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if new.status='HUMAN_REVIEW'
     and old.status is distinct from new.status
     and new.expert_review_status='NOT_REQUIRED' then
    new.expert_review_status:='PENDING';
  end if;
  return new;
end
$$;
create trigger review_expert_lifecycle before update of status on public.reviews
  for each row execute function public.app_triage_expert_lifecycle();

create function public.app_mark_final_report_issued() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.reviews
  set overall_result=case new.snapshot->>'result'
        when 'NEEDS_CORRECTION' then 'NEEDS_CORRECTION'::public.triage_overall_result
        when 'NO_ISSUE_DETECTED_IN_SCOPE' then 'NO_ISSUE_DETECTED_IN_SCOPE'::public.triage_overall_result
        when 'INSUFFICIENT_INFORMATION' then 'INSUFFICIENT_INFORMATION'::public.triage_overall_result
        else overall_result
      end,
      report_status='FINAL_REPORT_ISSUED',
      expert_review_status='EXPERT_REVIEWED',
      updated_at=now()
  where id=new.review_id;
  return new;
end
$$;
create trigger final_report_lifecycle after insert on public.reports
  for each row execute function public.app_mark_final_report_issued();

-- Atomic worker completion: persist findings and triage without weakening final approval.
create function public.vexim_complete_triage(
  jid uuid,
  worker_id text,
  new_findings jsonb,
  rule_refs jsonb,
  warnings text[],
  triage_data jsonb,
  pre_screening_snapshot jsonb default null
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare
  j public.pipeline_jobs;
  r public.reviews;
  route_value public.triage_route;
  result_value public.triage_overall_result;
  report_value public.triage_report_status;
  expert_value public.expert_review_status;
  base_target public.review_status;
  final_target public.review_status;
  run_id uuid;
  next_version integer;
  question_text text;
begin
  perform public.app_require_service();
  select * into j from public.pipeline_jobs
    where id=jid and status='running' and locked_by=worker_id and locked_until>now()
    for update;
  if not found then raise exception 'Job lease expired'; end if;
  select * into r from public.reviews where id=j.review_id for update;
  if jsonb_typeof(triage_data)<>'object'
     or jsonb_typeof(coalesce(triage_data->'reasons','[]'::jsonb))<>'array'
     or jsonb_typeof(coalesce(triage_data->'customer_questions','[]'::jsonb))<>'array'
     or jsonb_typeof(rule_refs)<>'array' then
    raise exception 'Invalid triage payload';
  end if;
  route_value:=(triage_data->>'triage_route')::public.triage_route;
  result_value:=(triage_data->>'overall_result')::public.triage_overall_result;
  report_value:=(triage_data->>'report_status')::public.triage_report_status;
  expert_value:=(triage_data->>'expert_review_status')::public.expert_review_status;
  if nullif(triage_data->>'policy_version','') is null
     or length(triage_data->>'policy_version')>100
     or nullif(triage_data->>'evaluated_at','') is null
     or coalesce((triage_data->>'risk_score')::integer,-1) not between 0 and 100 then
    raise exception 'Invalid triage policy metadata';
  end if;
  if (route_value='EXPERT_REVIEW_REQUIRED' and expert_value<>'PENDING')
     or (route_value<>'EXPERT_REVIEW_REQUIRED' and expert_value<>'NOT_REQUIRED') then
    raise exception 'Expert lifecycle status does not match triage route';
  end if;
  if (route_value='OUT_OF_SCOPE' and result_value<>'OUT_OF_SCOPE')
     or (route_value='BLOCKED_REGULATORY_SOURCE' and result_value<>'BLOCKED')
     or (route_value='EXPERT_REVIEW_REQUIRED' and result_value<>'NOT_ASSESSED')
     or (route_value='NEEDS_CUSTOMER_INFORMATION' and result_value<>'INSUFFICIENT_INFORMATION')
     or (route_value='AUTO_SCREENED' and result_value not in ('NO_AUTOMATED_ISSUE_DETECTED','POTENTIAL_ISSUES_FOUND')) then
    raise exception 'Triage outcome does not match the selected route';
  end if;
  if route_value='AUTO_SCREENED' then
    if pre_screening_snapshot is null then
      if report_value<>'DISABLED' then raise exception 'AUTO_SCREENED without an artifact must be disabled'; end if;
    else
      if report_value<>'PRE_SCREENING_ISSUED'
         or not public.vexim_pre_screening_allowed(r.organization_id)
         or pre_screening_snapshot->>'disclaimer_profile'<>'PRE_SCREENING_ONLY'
         or pre_screening_snapshot->>'triage_route'<>'AUTO_SCREENED' then
        raise exception 'Pre-screening feature gate or artifact profile is invalid';
      end if;
      if jsonb_pretty(pre_screening_snapshot) ~* '(FDA[[:space:]]+(approved|compliant)|được[[:space:]]+phép[[:space:]]+xuất[[:space:]]+khẩu|được[[:space:]]+FDA[[:space:]]+phê[[:space:]]+duyệt)' then
        raise exception 'Pre-screening artifact contains prohibited wording';
      end if;
    end if;
  elsif pre_screening_snapshot is not null then
    raise exception 'Only AUTO_SCREENED can create a pre-screening artifact';
  elsif report_value<>(case when route_value in ('OUT_OF_SCOPE','BLOCKED_REGULATORY_SOURCE') then 'BLOCKED'::public.triage_report_status else 'NOT_ISSUED'::public.triage_report_status end) then
    raise exception 'Report status does not match triage route';
  end if;

  base_target:=case route_value
    when 'OUT_OF_SCOPE' then 'MANUAL_ESCALATION_REQUIRED'::public.review_status
    when 'BLOCKED_REGULATORY_SOURCE' then 'SOURCE_UNAVAILABLE'::public.review_status
    when 'EXPERT_REVIEW_REQUIRED' then 'MANUAL_ESCALATION_REQUIRED'::public.review_status
    when 'NEEDS_CUSTOMER_INFORMATION' then 'MANUAL_ESCALATION_REQUIRED'::public.review_status
    else 'HUMAN_REVIEW'::public.review_status
  end;
  perform public.vexim_complete_rules(jid,worker_id,new_findings,rule_refs,warnings,base_target);

  select * into r from public.reviews where id=j.review_id for update;
  insert into public.review_triage_runs(
    review_id,organization_id,policy_version,triage_route,overall_result,risk_score,
    reasons,customer_questions,expert_review_status,report_status,rule_snapshot,evaluated_at
  ) values (
    r.id,r.organization_id,triage_data->>'policy_version',route_value,result_value,
    (triage_data->>'risk_score')::integer,triage_data->'reasons',triage_data->'customer_questions',
    expert_value,report_value,rule_refs,(triage_data->>'evaluated_at')::timestamptz
  ) returning id into run_id;

  if route_value='NEEDS_CUSTOMER_INFORMATION' then
    select string_agg(value,E'\n') into question_text
    from jsonb_array_elements_text(triage_data->'customer_questions') as q(value);
    if coalesce(length(trim(question_text)),0)<10 then
      raise exception 'Customer-information route requires specific questions';
    end if;
    insert into public.customer_requests(review_id,organization_id,message,requested_documents,created_by)
    values(r.id,r.organization_id,left(question_text,3000),array['Bổ sung thông tin/nhãn rõ nét'],r.requested_by);
    final_target:='WAITING_FOR_CUSTOMER';
  elsif route_value='AUTO_SCREENED' then
    final_target:='AI_REVIEW_READY';
  else
    final_target:=base_target;
  end if;

  if pre_screening_snapshot is not null then
    select coalesce(max(version),0)+1 into next_version
    from public.pre_screening_reports where review_id=r.id;
    insert into public.pre_screening_reports(
      review_id,organization_id,product_id,label_version_id,triage_run_id,version,disclaimer_profile,snapshot
    ) values(
      r.id,r.organization_id,r.product_id,r.label_version_id,run_id,next_version,
      'PRE_SCREENING_ONLY',pre_screening_snapshot
    );
  end if;

  update public.reviews set
    status=final_target,
    triage_route=route_value,
    overall_result=result_value,
    report_status=report_value,
    expert_review_status=expert_value,
    triage_reasons=triage_data->'reasons',
    triage_risk_score=(triage_data->>'risk_score')::integer,
    triage_policy_version=triage_data->>'policy_version',
    triage_evaluated_at=(triage_data->>'evaluated_at')::timestamptz,
    error_message=case
      when route_value='OUT_OF_SCOPE' then 'Product outside the currently supported automated scope.'
      when route_value='BLOCKED_REGULATORY_SOURCE' then 'Regulatory source/rule gates block automated issuance.'
      else null
    end,
    updated_at=now()
  where id=r.id;
  perform public.app_write_audit(r.organization_id,'review.triaged','review',r.id::text,
    'Risk triage completed · '||route_value::text,
    jsonb_build_object('route',route_value,'overall_result',result_value,'risk_score',(triage_data->>'risk_score')::integer,'policy_version',triage_data->>'policy_version','reason_count',jsonb_array_length(triage_data->'reasons'),'report_status',report_value));
end
$$;

alter table public.review_triage_runs enable row level security;
create policy triage_run_tenant_read on public.review_triage_runs for select to authenticated
  using(public.app_can_read_org(organization_id));
alter table public.pre_screening_reports enable row level security;
create policy pre_screening_report_tenant_read on public.pre_screening_reports for select to authenticated
  using(public.app_can_read_org(organization_id));
revoke all on public.review_triage_runs,public.pre_screening_reports from anon,authenticated;
grant select on public.review_triage_runs,public.pre_screening_reports to authenticated;
grant all on public.review_triage_runs,public.pre_screening_reports to service_role;

revoke all on function public.vexim_complete_triage(uuid,text,jsonb,jsonb,text[],jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.vexim_complete_triage(uuid,text,jsonb,jsonb,text[],jsonb,jsonb) to service_role;
revoke all on function public.vexim_pre_screening_allowed(uuid) from public,anon,authenticated;
grant execute on function public.vexim_pre_screening_allowed(uuid) to service_role;
revoke all on function public.vexim_set_triage_pre_screening(boolean,text,jsonb) from public,anon,service_role;
grant execute on function public.vexim_set_triage_pre_screening(boolean,text,jsonb) to authenticated;

commit;
