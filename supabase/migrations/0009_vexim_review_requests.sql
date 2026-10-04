-- Optional, explicit Vexim review requests. Triage recommendations and legacy
-- expert_review_status values are not requests and never open this workflow.
begin;

create type public.vexim_review_request_status as enum (
  'REQUESTED',
  'IN_PROGRESS',
  'COMPLETED'
);

-- Keep each request attached to one immutable review + exact artwork version.
alter table public.reviews
  add constraint reviews_id_org_label_version_unique
  unique (id, organization_id, label_version_id);

create table public.vexim_review_requests (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null,
  organization_id uuid not null,
  requested_by uuid not null references public.profiles(id),
  requested_role public.review_party_role not null
    check (requested_role in ('label_owner', 'commercial_importer')),
  requested_at timestamptz not null default now(),
  label_version_id uuid not null,
  artwork_hash text not null check (artwork_hash ~ '^[a-f0-9]{64}$'),
  status public.vexim_review_request_status not null default 'REQUESTED',
  reviewer_id uuid references public.profiles(id),
  started_at timestamptz,
  completed_at timestamptz,
  foreign key (review_id, organization_id, label_version_id)
    references public.reviews(id, organization_id, label_version_id)
    on delete restrict,
  foreign key (label_version_id, organization_id)
    references public.label_versions(id, organization_id)
    on delete restrict,
  unique (review_id),
  unique (id, review_id, organization_id, label_version_id, artwork_hash),
  check (
    (status = 'REQUESTED' and reviewer_id is null and started_at is null and completed_at is null)
    or (status = 'IN_PROGRESS' and reviewer_id is not null and started_at is not null and completed_at is null)
    or (status = 'COMPLETED' and reviewer_id is not null and started_at is not null and completed_at is not null)
  )
);
-- Earlier HUMAN_REVIEW state was opened implicitly from triage/status. Reclassify
-- orphaned live reviews as human-attention recommendations. Keep the protected,
-- read-only static demo row intact; the workspace masks its orphaned legacy state.
update public.reviews
set status = 'MANUAL_ESCALATION_REQUIRED', updated_at = now()
where status = 'HUMAN_REVIEW'
  and idempotency_key <> 'SRD-ANHIEN-LOTUS-DEMO-001';
create index vexim_review_requests_queue
  on public.vexim_review_requests(status, requested_at desc);
create index vexim_review_requests_org
  on public.vexim_review_requests(organization_id, requested_at desc);

alter table public.reports
  add column vexim_review_request_id uuid,
  add column artwork_sha256 text,
  add constraint reports_request_hash_pair check (
    (vexim_review_request_id is null and artwork_sha256 is null)
    or (vexim_review_request_id is not null and artwork_sha256 is not null and artwork_sha256 ~ '^[a-f0-9]{64}$')
  ),
  add constraint reports_vexim_request_binding
    foreign key (
      vexim_review_request_id,
      review_id,
      organization_id,
      label_version_id,
      artwork_sha256
    ) references public.vexim_review_requests (
      id,
      review_id,
      organization_id,
      label_version_id,
      artwork_hash
    ) on delete restrict;
create unique index reports_one_per_vexim_request
  on public.reports(vexim_review_request_id)
  where vexim_review_request_id is not null;

alter table public.vexim_review_requests enable row level security;
create policy vexim_review_request_read on public.vexim_review_requests
  for select to authenticated
  using (public.app_can_access_review(review_id));
revoke all on public.vexim_review_requests from anon, authenticated;
grant select on public.vexim_review_requests to authenticated;
grant all on public.vexim_review_requests to service_role;

-- The immutable request identity is authored by the requesting party. Only
-- REQUESTED -> IN_PROGRESS -> COMPLETED lifecycle updates are permitted.
create function public.app_vexim_review_request_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  r public.reviews;
  current_hash text;
  authorized_requester boolean := false;
begin
  if tg_op = 'DELETE' then
    raise exception 'Vexim review requests are append-only';
  end if;

  if tg_op = 'INSERT' then
    if not public.app_is_active() or new.requested_by is distinct from auth.uid() then
      raise exception 'An active owner/importer must create the Vexim request' using errcode='42501';
    end if;
    select * into r from public.reviews where id = new.review_id;
    if not found or r.organization_id is distinct from new.organization_id
       or r.label_version_id is distinct from new.label_version_id then
      raise exception 'Vexim request must bind to the review current label version';
    end if;

    if new.requested_role = 'label_owner' then
      authorized_requester := exists (
        select 1 from public.organization_members m
        join public.organizations o on o.id = m.organization_id
        where m.user_id = auth.uid()
          and m.organization_id = r.organization_id
          and m.role = 'customer_admin'
          and m.status = 'active'
          and o.status = 'active'
      );
    elsif new.requested_role = 'commercial_importer' then
      authorized_requester := exists (
        select 1 from public.review_participants rp
        join public.organization_members m on m.organization_id = rp.organization_id
        join public.organizations o on o.id = rp.organization_id
        where rp.review_id = r.id
          and rp.party_role = 'commercial_importer'
          and rp.status = 'active'
          and m.user_id = auth.uid()
          and m.role = 'customer_admin'
          and m.status = 'active'
          and o.status = 'active'
          and r.collaboration_status <> 'not_shared'
      );
    end if;
    if not authorized_requester then
      raise exception 'Only the label owner or active commercial importer admin may request Vexim review' using errcode='42501';
    end if;

    if r.status in ('DRAFT','INTAKE_PENDING','INPUT_VALIDATION','PROCESSING',
                    'PROCESSING_FAILED','MODEL_FAILED','APPROVED_WITH_NOTES',
                    'COMPLETED','ARCHIVED')
       or jsonb_typeof(r.pipeline) <> 'array'
       or jsonb_array_length(r.pipeline) < 5
       or exists (
         select 1 from jsonb_array_elements(r.pipeline) step
         where step->>'status' <> 'complete'
       ) then
      raise exception 'Self-check pipeline must be complete before requesting Vexim review';
    end if;

    current_hash := public.vexim_current_label_bundle_sha256(r.label_version_id);
    if current_hash is null then
      raise exception 'Every original artwork file must pass a real malware scan before requesting Vexim review';
    end if;
    if new.artwork_hash is distinct from current_hash then
      raise exception 'Client-supplied artwork hash is not accepted';
    end if;

    if exists (select 1 from public.reports p where p.review_id = r.id) then
      raise exception 'A report already exists for this review';
    end if;
    new.requested_at := now();
    new.status := 'REQUESTED';
    new.reviewer_id := null;
    new.started_at := null;
    new.completed_at := null;
    return new;
  end if;

  if old.id is distinct from new.id
     or old.review_id is distinct from new.review_id
     or old.organization_id is distinct from new.organization_id
     or old.requested_by is distinct from new.requested_by
     or old.requested_role is distinct from new.requested_role
     or old.requested_at is distinct from new.requested_at
     or old.label_version_id is distinct from new.label_version_id
     or old.artwork_hash is distinct from new.artwork_hash then
    raise exception 'Vexim request identity, requester and artwork binding are immutable';
  end if;

  if old.status = 'REQUESTED' and new.status = 'IN_PROGRESS' then
    if public.app_staff() is distinct from 'reviewer'
       or new.reviewer_id is distinct from auth.uid()
       or new.started_at is null
       or new.completed_at is not null then
      raise exception 'Only an active reviewer may start an existing Vexim request' using errcode='42501';
    end if;
  elsif old.status = 'IN_PROGRESS' and new.status = 'COMPLETED' then
    if public.app_staff() is distinct from 'reviewer'
       or new.reviewer_id is distinct from old.reviewer_id
       or new.started_at is distinct from old.started_at
       or new.completed_at is null
       or not exists (
         select 1 from public.reports p
         where p.vexim_review_request_id = old.id
       ) then
      raise exception 'A Vexim request can complete only with its bound report' using errcode='42501';
    end if;
  else
    raise exception 'Invalid Vexim review request lifecycle transition';
  end if;
  return new;
end
$$;
create trigger vexim_review_request_guard
  before insert or update or delete on public.vexim_review_requests
  for each row execute function public.app_vexim_review_request_guard();

-- Party action: the server computes the hash from the immutable, malware-clean
-- original-file manifest. No triage field, status, or client hash creates a request.
create function public.vexim_create_review_request(rid uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  r public.reviews;
  role_value public.review_party_role;
  bundle_hash text;
  q public.vexim_review_requests;
begin
  if not public.app_is_active() then
    raise exception 'Active account required' using errcode='42501';
  end if;
  select * into r from public.reviews where id = rid for update;
  if not found then raise exception 'Review unavailable' using errcode='42501'; end if;

  if exists (
    select 1 from public.organization_members m
    join public.organizations o on o.id = m.organization_id
    where m.user_id = auth.uid()
      and m.organization_id = r.organization_id
      and m.role = 'customer_admin'
      and m.status = 'active'
      and o.status = 'active'
  ) then
    role_value := 'label_owner';
  elsif exists (
    select 1 from public.review_participants rp
    join public.organization_members m on m.organization_id = rp.organization_id
    join public.organizations o on o.id = rp.organization_id
    where rp.review_id = r.id
      and rp.party_role = 'commercial_importer'
      and rp.status = 'active'
      and m.user_id = auth.uid()
      and m.role = 'customer_admin'
      and m.status = 'active'
      and o.status = 'active'
      and r.collaboration_status <> 'not_shared'
  ) then
    role_value := 'commercial_importer';
  else
    raise exception 'Only the label owner or active commercial importer admin may request Vexim review' using errcode='42501';
  end if;

  if r.status in ('DRAFT','INTAKE_PENDING','INPUT_VALIDATION','PROCESSING',
                  'PROCESSING_FAILED','MODEL_FAILED','APPROVED_WITH_NOTES',
                  'COMPLETED','ARCHIVED')
     or jsonb_typeof(r.pipeline) <> 'array'
     or jsonb_array_length(r.pipeline) < 5
     or exists (
       select 1 from jsonb_array_elements(r.pipeline) step
       where step->>'status' <> 'complete'
     ) then
    raise exception 'Self-check pipeline must be complete before requesting Vexim review';
  end if;

  if exists (select 1 from public.reports p where p.review_id = r.id) then
    raise exception 'A report already exists for this review';
  end if;
  bundle_hash := public.vexim_current_label_bundle_sha256(r.label_version_id);
  if bundle_hash is null then
    raise exception 'Every original artwork file must pass a real malware scan before requesting Vexim review';
  end if;

  insert into public.vexim_review_requests(
    review_id, organization_id, requested_by, requested_role,
    label_version_id, artwork_hash
  ) values (
    r.id, r.organization_id, auth.uid(), role_value,
    r.label_version_id, bundle_hash
  ) returning * into q;

  perform public.app_write_audit(
    r.organization_id,
    'vexim_review.requested',
    'vexim_review_request',
    q.id::text,
    'Owner/importer requested an optional Vexim Review for the exact label version',
    jsonb_build_object(
      'review_id', r.id,
      'requested_role', role_value,
      'label_version_id', q.label_version_id,
      'artwork_hash', q.artwork_hash
    )
  );
  return to_jsonb(q);
end
$$;

create function public.vexim_start_review_request(request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  q public.vexim_review_requests;
  r public.reviews;
  current_hash text;
begin
  perform public.app_require_staff('reviewer');
  select * into q from public.vexim_review_requests where id = request_id;
  if not found then raise exception 'Vexim request unavailable' using errcode='42501'; end if;
  select * into r from public.reviews where id = q.review_id for update;
  select * into q from public.vexim_review_requests where id = request_id for update;
  if not found or q.review_id <> r.id or q.label_version_id <> r.label_version_id then
    raise exception 'Vexim request is not bound to the current review version';
  end if;
  if q.status <> 'REQUESTED' then
    raise exception 'Only an existing REQUESTED Vexim review can be started';
  end if;
  current_hash := public.vexim_current_label_bundle_sha256(q.label_version_id);
  if current_hash is null or current_hash <> q.artwork_hash then
    raise exception 'Artwork hash/version changed or original malware scan is not clean';
  end if;

  update public.vexim_review_requests
  set status = 'IN_PROGRESS', reviewer_id = auth.uid(), started_at = now()
  where id = q.id returning * into q;
  update public.reviews
  set status = 'HUMAN_REVIEW', assigned_to = auth.uid(), updated_at = now()
  where id = r.id;
  perform public.app_write_audit(
    r.organization_id,
    'vexim_review.started',
    'vexim_review_request',
    q.id::text,
    'Reviewer started an existing Vexim Review request',
    jsonb_build_object('review_id', r.id, 'label_version_id', q.label_version_id)
  );
  return to_jsonb(q);
end
$$;

create function public.app_editable_vexim_review(rid uuid)
returns public.reviews language plpgsql security definer set search_path=public,pg_temp as $$
declare
  r public.reviews;
  q public.vexim_review_requests;
begin
  r := public.app_editable_review(rid);
  select * into q from public.vexim_review_requests
  where review_id = r.id and status = 'IN_PROGRESS'
  for update;
  if not found or q.label_version_id <> r.label_version_id then
    raise exception 'An IN_PROGRESS VeximReviewRequest for this exact label version is required' using errcode='42501';
  end if;
  return r;
end
$$;

-- Vexim-specific edits, customer-info requests and state transitions are now
-- possible only inside an explicit in-progress request. Pipeline retry and
-- triage-generated customer information remain separate self-check operations.
create or replace function public.vexim_update_finding(fid uuid,p jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare f public.findings; r public.reviews; refs uuid[]; pending boolean;
begin
  select * into f from public.findings where id=fid;
  if not found then raise exception 'Finding unavailable' using errcode='42501'; end if;
  r := public.app_editable_vexim_review(f.review_id);
  if length(trim(coalesce(p->>'reviewer_comment',''))) < 5 then raise exception 'Reviewer reason required'; end if;
  refs := case when p ? 'citation_ids' then array(select jsonb_array_elements_text(p->'citation_ids')::uuid) else f.citation_ids end;
  if exists(select 1 from unnest(refs) ref where not exists(select 1 from public.regulatory_sources s where s.id=ref)) then raise exception 'Citation outside registry'; end if;
  pending := cardinality(refs)=0 or exists(select 1 from public.regulatory_sources s where s.id=any(refs) and not public.app_source_current(s));
  update public.findings
  set severity=(p->>'severity')::public.finding_severity,
      status=(p->>'status')::public.finding_status,
      reviewer_comment=trim(p->>'reviewer_comment'),
      citation_ids=refs,citation_pending=pending,
      reviewed_by=auth.uid(),reviewed_at=now()
  where id=fid returning * into f;
  return to_jsonb(f);
end
$$;

create or replace function public.vexim_add_finding(rid uuid,p jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.reviews; f public.findings; refs uuid[];
begin
  r := public.app_editable_vexim_review(rid);
  perform public.app_validate_evidence(p->'evidence',r.label_version_id);
  if length(trim(p->>'title'))<2 or length(trim(p->>'description'))<10 or length(trim(p->>'suggested_action'))<2 then
    raise exception 'Finding content required';
  end if;
  if ((p->>'title')||' '||(p->>'description')||' '||(p->>'suggested_action')) ~* '(FDA (approved|certified)|guaranteed customs clearance|100% legal)' then
    raise exception 'Forbidden absolute claim';
  end if;
  refs := array(select jsonb_array_elements_text(coalesce(p->'citation_ids','[]'))::uuid);
  if exists(select 1 from unnest(refs) ref where not exists(select 1 from public.regulatory_sources where id=ref)) then
    raise exception 'Citation outside registry';
  end if;
  insert into public.findings(
    review_id,organization_id,rule_key,rule_version,severity,title,description,
    evidence,citation_ids,citation_pending,suggested_action,reasoning_category
  ) values (
    rid,r.organization_id,'MANUAL',1,(p->>'severity')::public.finding_severity,
    p->>'title',p->>'description',p->'evidence',refs,
    cardinality(refs)=0 or exists(select 1 from public.regulatory_sources s where s.id=any(refs) and not public.app_source_current(s)),
    p->>'suggested_action','manual'
  ) returning * into f;
  return to_jsonb(f);
end
$$;

create or replace function public.vexim_update_field(lid uuid,fid uuid,new_value text,reason text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.reviews;
begin
  select * into r from public.reviews where label_version_id=lid;
  if not found then raise exception 'Review unavailable'; end if;
  r := public.app_editable_vexim_review(r.id);
  if length(trim(reason))<5 then raise exception 'Reason required'; end if;
  update public.extracted_fields
  set value=nullif(new_value,''),manually_verified=true,confidence=1,extraction_model='human-verified'
  where id=fid and label_version_id=lid;
  if not found then raise exception 'Field unavailable'; end if;
  update public.reviews
  set rule_snapshot='[]',missing_information=array_append(missing_information,'Extracted value changed. Re-run rules before report approval.')
  where id=r.id;
  perform public.app_write_audit(r.organization_id,'extraction.verified','label_version',lid::text,reason,jsonb_build_object('field_id',fid,'evidence_preserved',true));
end
$$;

create or replace function public.vexim_request_information(rid uuid,message text,documents text[])
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.reviews;
begin
  r := public.app_editable_vexim_review(rid);
  if r.status not in ('HUMAN_REVIEW','REVISION_REQUIRED','MANUAL_ESCALATION_REQUIRED','WAITING_FOR_CUSTOMER','AI_REVIEW_READY') then
    raise exception 'Invalid review stage for information request';
  end if;
  insert into public.customer_requests(review_id,organization_id,message,requested_documents,created_by)
  values(rid,r.organization_id,trim(message),documents,auth.uid());
  update public.reviews set status='WAITING_FOR_CUSTOMER',updated_at=now() where id=rid;
end
$$;

create or replace function public.vexim_resolve_request(request_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.customer_requests; r public.reviews;
begin
  perform public.app_require_staff('reviewer');
  select * into q from public.customer_requests where id=request_id for update;
  if not found then raise exception 'Request unavailable'; end if;
  select * into r from public.reviews where id=q.review_id for update;
  if not found or not public.app_can_read_org(r.organization_id) then
    raise exception 'Review unavailable' using errcode='42501';
  end if;
  update public.customer_requests set status='resolved' where id=request_id;
  if not exists(select 1 from public.customer_requests where review_id=q.review_id and status='open')
     and r.status='WAITING_FOR_CUSTOMER' then
    -- Returning from a triage/customer-information step does not create or
    -- imply a Vexim Review request.
    update public.reviews set status='AI_REVIEW_READY',updated_at=now() where id=r.id;
  end if;
end
$$;

create or replace function public.vexim_transition_review(rid uuid,target public.review_status,reason text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.reviews; allowed boolean:=false; request_exists boolean:=false;
begin
  select * into r from public.reviews where id=rid for update;
  if not found or not coalesce(public.app_can_read_org(r.organization_id),false) then
    raise exception 'Review unavailable' using errcode='42501';
  end if;
  if length(trim(reason))<5 then raise exception 'Reason required'; end if;
  if target='ARCHIVED' then
    allowed:=r.status in ('DRAFT','INTAKE_PENDING','WAITING_FOR_CUSTOMER','REVISION_REQUIRED','COMPLETED','PROCESSING_FAILED','SOURCE_UNAVAILABLE','MODEL_FAILED','MANUAL_ESCALATION_REQUIRED')
      and (public.app_staff() in ('reviewer','system_admin') or public.app_can_admin_org(r.organization_id));
  else
    perform public.app_require_staff('reviewer');
    select exists(
      select 1 from public.vexim_review_requests q
      where q.review_id=rid and q.label_version_id=r.label_version_id and q.status='IN_PROGRESS'
    ) into request_exists;
    if not request_exists then
      raise exception 'An IN_PROGRESS VeximReviewRequest is required for reviewer lifecycle actions' using errcode='42501';
    end if;
    allowed:=case r.status
      when 'AI_REVIEW_READY' then target='HUMAN_REVIEW'
      when 'HUMAN_REVIEW' then target in ('WAITING_FOR_CUSTOMER','REVISION_REQUIRED','MANUAL_ESCALATION_REQUIRED')
      when 'WAITING_FOR_CUSTOMER' then target in ('HUMAN_REVIEW','REVISION_REQUIRED')
      when 'REVISION_REQUIRED' then target='HUMAN_REVIEW'
      when 'SOURCE_UNAVAILABLE' then target='HUMAN_REVIEW'
      when 'MANUAL_ESCALATION_REQUIRED' then target in ('HUMAN_REVIEW','WAITING_FOR_CUSTOMER')
      else false
    end;
  end if;
  if not coalesce(allowed,false) then raise exception 'Invalid state transition'; end if;
  update public.reviews set status=target,updated_at=now() where id=rid;
  perform public.app_write_audit(r.organization_id,'review.status_changed','review',rid::text,reason,jsonb_build_object('from',r.status,'to',target));
end
$$;

-- A generic queue assignment may target a review only after an explicit request exists.
create or replace function public.vexim_assign_review(rid uuid,reviewer_id uuid,reason text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.reviews;
begin
  if not public.app_is_active() or not coalesce(public.app_staff() in ('reviewer','system_admin'),false) then
    raise exception 'Reviewer or system admin required' using errcode='42501';
  end if;
  if public.app_staff()='reviewer' and reviewer_id<>auth.uid() then
    raise exception 'Reviewer may only claim their own task' using errcode='42501';
  end if;
  if not exists(select 1 from public.profiles where id=reviewer_id and staff_role='reviewer' and active)
     or length(trim(reason))<5 then
    raise exception 'Active reviewer and assignment reason required';
  end if;
  select * into r from public.reviews where id=rid for update;
  if not found or r.status in ('COMPLETED','APPROVED_WITH_NOTES','ARCHIVED') then
    raise exception 'Review closed or unavailable';
  end if;
  if not exists (
    select 1 from public.vexim_review_requests q
    where q.review_id=rid and q.label_version_id=r.label_version_id
      and q.status in ('REQUESTED','IN_PROGRESS')
  ) then
    raise exception 'An existing VeximReviewRequest is required before assignment' using errcode='42501';
  end if;
  update public.reviews set assigned_to=reviewer_id,updated_at=now() where id=rid;
  update public.products set assigned_to=reviewer_id,updated_at=now() where id=r.product_id;
  perform public.app_write_audit(r.organization_id,'review.assigned','review',rid::text,trim(reason),jsonb_build_object('previous',r.assigned_to,'assigned_to',reviewer_id));
end
$$;

-- No trigger or triage path may synthesize an expert-review state. Historical
-- values are retained only in reports/history; the active legacy column is neutral.
drop trigger if exists review_expert_lifecycle on public.reviews;
drop function if exists public.app_triage_expert_lifecycle();
-- Keep the legacy column for compatibility. New live submissions start neutral;
-- the protected static demo seed retains its original PENDING fixture value.
create function public.app_neutralize_legacy_expert_on_submit()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.idempotency_key is distinct from 'SRD-ANHIEN-LOTUS-DEMO-001' then
    new.expert_review_status := 'NOT_REQUIRED';
  end if;
  return new;
end
$$;
create trigger review_neutralize_legacy_expert
  before insert on public.reviews
  for each row execute function public.app_neutralize_legacy_expert_on_submit();
-- Keep historical expert_review_status values intact. Neither they nor the
-- append-only review_triage_runs lifecycle column prove that a request exists.

-- Pipeline completion can publish self-check readiness or a human-attention
-- recommendation, but it cannot open the Vexim reviewer lifecycle.
create or replace function public.vexim_complete_rules(
  jid uuid,
  worker_id text,
  new_findings jsonb,
  rule_refs jsonb,
  warnings text[],
  target public.review_status
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare
  j public.pipeline_jobs;
  r public.reviews;
  f jsonb;
  refs uuid[];
begin
  perform public.app_require_service();
  select * into j from public.pipeline_jobs
  where id=jid and status='running' and locked_by=worker_id and locked_until>now()
  for update;
  if not found then raise exception 'Job lease expired'; end if;
  select * into r from public.reviews where id=j.review_id for update;
  if target not in ('AI_REVIEW_READY','SOURCE_UNAVAILABLE','MANUAL_ESCALATION_REQUIRED') then
    raise exception 'Pipeline may finish self-check or recommend attention, but cannot open Vexim Review or approve a report';
  end if;
  if jsonb_typeof(new_findings)<>'array' or jsonb_typeof(rule_refs)<>'array' then
    raise exception 'Findings and rule snapshots must be arrays';
  end if;
  delete from public.findings where review_id=r.id;
  for f in select * from jsonb_array_elements(new_findings) loop
    perform public.app_validate_evidence(f->'evidence',r.label_version_id);
    refs:=array(select jsonb_array_elements_text(f->'citation_ids')::uuid);
    if exists(select 1 from unnest(refs) ref where not exists(select 1 from public.regulatory_sources where id=ref)) then
      raise exception 'Citation outside registry';
    end if;
    if ((f->>'title')||' '||(f->>'description')||' '||(f->>'suggested_action')) ~* '(FDA (approved|certified)|guaranteed customs clearance|100% legal)' then
      raise exception 'Forbidden absolute claim';
    end if;
    insert into public.findings(
      review_id,organization_id,rule_key,rule_version,severity,title,description,
      evidence,citation_ids,citation_pending,suggested_action,ai_confidence,
      reasoning_category,human_review_required
    ) values (
      r.id,r.organization_id,f->>'rule_key',(f->>'rule_version')::integer,
      (f->>'severity')::public.finding_severity,f->>'title',f->>'description',
      f->'evidence',refs,
      cardinality(refs)=0 or exists(
        select 1 from public.regulatory_sources s
        where s.id=any(refs) and not public.app_source_current(s)
      ),
      f->>'suggested_action',nullif(f->>'ai_confidence','')::numeric,
      f->>'reasoning_category',true
    );
    perform public.app_write_audit(
      r.organization_id,'rule.fired','review',r.id::text,
      (f->>'rule_key')||' v'||(f->>'rule_version'),
      jsonb_build_object('rule_key',f->>'rule_key')
    );
  end loop;
  update public.reviews
  set status=target,progress=100,rule_snapshot=rule_refs,missing_information=warnings,
      error_message=case when target='SOURCE_UNAVAILABLE' then 'Incomplete or unavailable approved ruleset' else null end,
      updated_at=now(),
      pipeline=(select jsonb_agg(s||jsonb_build_object('status','complete','completed_at',now()))
                from jsonb_array_elements(pipeline) s)
  where id=r.id;
  update public.label_versions set status='under_review' where id=r.label_version_id;
  update public.pipeline_jobs
  set status='completed',locked_by=null,locked_until=null,updated_at=now()
  where id=jid;
end
$$;

-- Risk triage records recommendation and self-check state only. It never stores
-- PENDING and never constructs a VeximReviewRequest from its route.
create or replace function public.vexim_complete_triage(
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
  if triage_data ? 'expert_review_status'
     and triage_data->>'expert_review_status' <> 'NOT_REQUIRED' then
    raise exception 'Triage cannot set Vexim review lifecycle state';
  end if;
  route_value:=(triage_data->>'triage_route')::public.triage_route;
  result_value:=(triage_data->>'overall_result')::public.triage_overall_result;
  report_value:=(triage_data->>'report_status')::public.triage_report_status;
  if nullif(triage_data->>'policy_version','') is null
     or length(triage_data->>'policy_version')>100
     or nullif(triage_data->>'evaluated_at','') is null
     or coalesce((triage_data->>'risk_score')::integer,-1) not between 0 and 100 then
    raise exception 'Invalid triage policy metadata';
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
    else 'AI_REVIEW_READY'::public.review_status
  end;
  perform public.vexim_complete_rules(jid,worker_id,new_findings,rule_refs,warnings,base_target);

  select * into r from public.reviews where id=j.review_id for update;
  insert into public.review_triage_runs(
    review_id,organization_id,policy_version,triage_route,overall_result,risk_score,
    reasons,customer_questions,expert_review_status,report_status,rule_snapshot,evaluated_at
  ) values (
    r.id,r.organization_id,triage_data->>'policy_version',route_value,result_value,
    (triage_data->>'risk_score')::integer,triage_data->'reasons',triage_data->'customer_questions',
    'NOT_REQUIRED',report_value,rule_refs,(triage_data->>'evaluated_at')::timestamptz
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
    expert_review_status='NOT_REQUIRED',
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

-- Existing RPCs are still useful for self-check lifecycle operations; Vexim
-- decision operations use the separate request-aware wrapper above.
create or replace function public.vexim_retry_review(rid uuid,stage text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.reviews; j public.pipeline_jobs;
begin
  r := public.app_editable_review(rid);
  if rid = '30000000-0000-4000-8000-000000000001'
     and r.idempotency_key = 'SRD-ANHIEN-LOTUS-DEMO-001' then
    raise exception 'Synthetic demo review is view-only; pipeline reruns are disabled' using errcode='42501';
  end if;
  if stage not in ('validation','ocr','extraction','rules','verification') then raise exception 'Invalid stage'; end if;
  select * into j from public.pipeline_jobs where review_id=rid for update;
  if j.status='running' and j.locked_until>now() then raise exception 'Worker is already running this review'; end if;
  update public.pipeline_jobs
  set status='queued',from_stage=stage,current_stage=stage,attempts=0,next_run_at=now(),
      locked_by=null,locked_until=null,last_error=null,updated_at=now()
  where review_id=rid;
  update public.reviews
  set status='PROCESSING',error_message=null,rule_snapshot='[]',updated_at=now(),
      pipeline=(select jsonb_agg(case
        when (s->>'stage') in (
          select x from unnest(array['validation','ocr','extraction','rules','verification']) with ordinality a(x,n)
          where n>=array_position(array['validation','ocr','extraction','rules','verification'],stage)
        ) then jsonb_set(s,'{status}','"pending"') else s end)
        from jsonb_array_elements(r.pipeline) s)
  where id=rid;
  perform public.app_write_audit(r.organization_id,'review.retried','review',rid::text,'Retry from '||stage,jsonb_build_object('stage',stage));
end
$$;

-- Close generic assignment and reviewer-edit paths unless a real request exists.
create or replace function public.app_mark_final_report_issued()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.vexim_review_requests;
begin
  update public.vexim_review_requests
  set status='COMPLETED',completed_at=now()
  where id=new.vexim_review_request_id and status='IN_PROGRESS'
  returning * into q;
  if not found then raise exception 'Final Vexim report requires an IN_PROGRESS request'; end if;

  update public.reviews
  set overall_result=case new.snapshot->>'result'
        when 'NEEDS_CORRECTION' then 'NEEDS_CORRECTION'::public.triage_overall_result
        when 'NO_ISSUE_DETECTED_IN_SCOPE' then 'NO_ISSUE_DETECTED_IN_SCOPE'::public.triage_overall_result
        when 'INSUFFICIENT_INFORMATION' then 'INSUFFICIENT_INFORMATION'::public.triage_overall_result
        else overall_result
      end,
      report_status='FINAL_REPORT_ISSUED',updated_at=now()
  where id=new.review_id;
  return new;
end
$$;
create function public.app_report_vexim_request_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.vexim_review_requests; r public.reviews; current_hash text;
begin
  if public.app_staff() is distinct from 'reviewer' then
    raise exception 'Only a reviewer may issue a Vexim report' using errcode='42501';
  end if;
  if new.vexim_review_request_id is null or new.artwork_sha256 is null then
    raise exception 'A VeximReviewRequest is required before a Vexim report can be issued';
  end if;
  select * into q from public.vexim_review_requests
  where id=new.vexim_review_request_id for update;
  if not found then raise exception 'Vexim request unavailable'; end if;
  select * into r from public.reviews where id=q.review_id;
  if not found
     or q.status <> 'IN_PROGRESS'
     or q.review_id <> new.review_id
     or q.organization_id <> new.organization_id
     or q.label_version_id <> new.label_version_id
     or q.label_version_id <> r.label_version_id
     or q.artwork_hash <> new.artwork_sha256 then
    raise exception 'Report request, review, label version and artwork hash must match exactly';
  end if;
  current_hash := public.vexim_current_label_bundle_sha256(q.label_version_id);
  if current_hash is null then
    raise exception 'Every original artwork file must pass real malware scan before report issuance';
  end if;
  if current_hash <> q.artwork_hash then
    raise exception 'Artwork hash changed after the Vexim request; issue no report for this version';
  end if;
  new.snapshot := jsonb_set(
    new.snapshot,
    '{vexim_review_request}',
    jsonb_build_object(
      'id',q.id,
      'requested_by',q.requested_by,
      'requested_role',q.requested_role,
      'requested_at',q.requested_at,
      'label_version_id',q.label_version_id,
      'artwork_hash',q.artwork_hash
    ),
    true
  );
  return new;
end
$$;
create trigger report_vexim_request_guard
  before insert on public.reports
  for each row execute function public.app_report_vexim_request_guard();

create function public.app_report_request_binding_immutable()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if old.vexim_review_request_id is distinct from new.vexim_review_request_id
     or old.artwork_sha256 is distinct from new.artwork_sha256
     or old.review_id is distinct from new.review_id
     or old.organization_id is distinct from new.organization_id
     or old.product_id is distinct from new.product_id
     or old.label_version_id is distinct from new.label_version_id then
    raise exception 'Report request/version/hash binding is immutable';
  end if;
  return new;
end
$$;
create trigger report_request_binding_immutable
  before update on public.reports
  for each row execute function public.app_report_request_binding_immutable();

-- Keep sign-off snapshots versioned and preserve the exact request metadata.
create or replace function public.app_report_signoff_snapshot()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare disposition_value text; approved_by_value jsonb; rationale_value text;
begin
  disposition_value := new.snapshot->>'result';
  approved_by_value := new.snapshot#>'{reviewer,id}';
  rationale_value := new.snapshot#>>'{reviewer,comment}';
  if disposition_value is null or disposition_value not in (
    'NEEDS_CORRECTION','NO_ISSUE_DETECTED_IN_SCOPE','INSUFFICIENT_INFORMATION'
  ) then raise exception 'Report disposition is missing or invalid'; end if;
  if coalesce(jsonb_typeof(approved_by_value),'null') <> 'string'
     or coalesce(length(trim(rationale_value)),0) < 10 then
    raise exception 'Reviewer identity and rationale are required for sign-off';
  end if;
  new.snapshot := jsonb_set(new.snapshot,'{disposition}',to_jsonb(disposition_value),true);
  new.snapshot := jsonb_set(new.snapshot,'{approved_by}',approved_by_value,true);
  new.snapshot := jsonb_set(new.snapshot,'{rationale}',to_jsonb(rationale_value),true);
  new.snapshot := jsonb_set(new.snapshot,'{schema_version}','"1.2"'::jsonb,true);
  return new;
end
$$;

-- The old two-argument report RPC is intentionally removed: it has no request ID
-- and must not remain as a bypass around the request gate.
revoke all on function public.vexim_approve_report(uuid,text) from public,anon,authenticated,service_role;
drop function public.vexim_approve_report(uuid,text);

create function public.vexim_approve_report(rid uuid,request_id uuid,comment text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  r public.reviews;
  q public.vexim_review_requests;
  existing public.reports;
  report_row public.reports;
  outcome text;
  snapshot jsonb;
  reviewer_name text;
  sources jsonb;
  allfindings jsonb;
  ref jsonb;
  rule jsonb;
  disclaimer text;
  current_hash text;
begin
  perform public.app_require_staff('reviewer');
  select * into r from public.reviews where id=rid for update;
  if not found or not public.app_can_read_org(r.organization_id) then
    raise exception 'Review unavailable' using errcode='42501';
  end if;
  select * into q from public.vexim_review_requests
  where id=request_id and review_id=rid for update;
  if not found or q.organization_id <> r.organization_id
     or q.label_version_id <> r.label_version_id then
    raise exception 'A VeximReviewRequest for this exact review version is required';
  end if;

  select * into existing from public.reports where review_id=rid;
  if found then
    if existing.vexim_review_request_id=q.id
       and existing.artwork_sha256=q.artwork_hash
       and q.status='COMPLETED' then
      return to_jsonb(existing);
    end if;
    raise exception 'A different or legacy report already exists for this review';
  end if;
  if q.status <> 'IN_PROGRESS' then
    raise exception 'Only an IN_PROGRESS VeximReviewRequest can issue a report';
  end if;
  current_hash := public.vexim_current_label_bundle_sha256(q.label_version_id);
  if current_hash is null then
    raise exception 'Every original must pass malware scan before final report';
  end if;
  if current_hash <> q.artwork_hash then
    raise exception 'Artwork hash/version changed after the request';
  end if;
  if length(trim(comment))<10
     or jsonb_array_length(r.rule_snapshot)<15
     or exists(select 1 from jsonb_array_elements(r.pipeline) step where step->>'status'<>'complete') then
    raise exception 'Incomplete review or ruleset snapshot';
  end if;
  if exists(select 1 from public.findings f where f.review_id=rid and (
      f.status='open' or f.reviewed_by is null or length(trim(f.reviewer_comment))<5
  )) then raise exception 'Every finding must have a reasoned reviewer decision'; end if;
  if exists(select 1 from public.findings f where f.review_id=rid and f.status='accepted'
    and f.severity in ('critical','major') and (
      f.citation_pending or cardinality(f.citation_ids)=0
      or exists(select 1 from public.regulatory_sources s where s.id=any(f.citation_ids) and not public.app_source_current(s))
    )) then raise exception 'Major/Critical finding requires current registry citation'; end if;

  for rule in select * from jsonb_array_elements(r.rule_snapshot) loop
    if not exists(
      select 1 from public.compliance_rules cr
      where cr.rule_key=rule->>'rule_key'
        and cr.version=(rule->>'version')::integer
        and cr.status='ACTIVE'
        and cr.source_snapshot @> (rule->'source_versions')
        and (rule->'source_versions') @> cr.source_snapshot
        and (cr.effective_from is null or cr.effective_from<=current_date)
        and (cr.effective_to is null or cr.effective_to>=current_date)
    ) then raise exception 'Ruleset changed or expired; rerun review'; end if;
    if jsonb_array_length(rule->'source_versions')=0 then raise exception 'Ruleset source snapshot missing'; end if;
    for ref in select * from jsonb_array_elements(rule->'source_versions') loop
      if not exists(
        select 1 from public.regulatory_sources s
        where s.id=(ref->>'id')::uuid
          and s.version=(ref->>'version')::integer
          and s.content_hash=ref->>'content_hash'
          and public.app_source_current(s)
      ) then raise exception 'Source changed or expired; rerun review'; end if;
    end loop;
  end loop;

  outcome := case
    when exists(select 1 from public.findings where review_id=rid and status='accepted' and severity in ('critical','major')) then 'NEEDS_CORRECTION'
    when cardinality(r.missing_information)>0 or exists(select 1 from public.customer_requests where review_id=rid and status='open') then 'INSUFFICIENT_INFORMATION'
    else 'NO_ISSUE_DETECTED_IN_SCOPE'
  end;
  select full_name into reviewer_name from public.profiles where id=auth.uid();
  select coalesce(jsonb_agg(to_jsonb(f) order by f.severity,f.created_at),'[]')
    into allfindings from public.findings f where review_id=rid;
  select coalesce(jsonb_agg(to_jsonb(s) order by s.priority,s.id),'[]')
    into sources from public.regulatory_sources s
    where s.id in (
      select unnest(f.citation_ids) from public.findings f where f.review_id=rid
      union
      select (source_ref.value->>'id')::uuid
      from jsonb_array_elements(r.rule_snapshot) ru
      cross join lateral jsonb_array_elements(ru->'source_versions') as source_ref(value)
    );
  disclaimer := 'Đây là đánh giá sơ bộ trong phạm vi nhãn thực phẩm liên bang Hoa Kỳ, dựa trên dữ liệu được cung cấp và phiên bản nguồn / quy tắc tại thời điểm rà soát. Báo cáo không phải phê duyệt hoặc chứng nhận của FDA, không bảo đảm thông quan và không thay thế tư vấn pháp lý. Kết luận phải được chuyên viên Vexim xác nhận.'
    || chr(10) || chr(10)
    || 'This is a preliminary review within the stated US federal food-labeling scope, based on supplied information and recorded source/rule versions. It is not FDA approval or certification, does not guarantee customs clearance, and is not a substitute for legal advice.';
  snapshot := jsonb_build_object(
    'schema_version','1.2',
    'review_id',rid,
    'product',r.dossier_snapshot,
    'label_version',public.app_label_json(r.label_version_id),
    'review_scope',r.review_scope,
    'result',outcome,
    'disclaimer',disclaimer,
    'findings',allfindings,
    'sources',sources,
    'reviewer',jsonb_build_object('id',auth.uid(),'name',reviewer_name,'approved_at',now(),'comment',trim(comment)),
    'vexim_review_request',jsonb_build_object(
      'id',q.id,'requested_by',q.requested_by,'requested_role',q.requested_role,
      'requested_at',q.requested_at,'label_version_id',q.label_version_id,
      'artwork_hash',q.artwork_hash
    ),
    'version_history',coalesce((select jsonb_agg(jsonb_build_object('version',version,'uploaded_at',uploaded_at) order by version) from public.label_versions where product_id=r.product_id),'[]'),
    'missing_information',to_jsonb(r.missing_information),
    'customer_requests',coalesce((select jsonb_agg(to_jsonb(cq)) from public.customer_requests cq where cq.review_id=rid),'[]'),
    'rule_snapshot',r.rule_snapshot,
    'generated_at',now(),
    'demo',false
  );
  insert into public.reports(
    review_id,organization_id,product_id,label_version_id,snapshot,
    vexim_review_request_id,artwork_sha256
  ) values (
    rid,r.organization_id,r.product_id,r.label_version_id,snapshot,q.id,q.artwork_hash
  ) returning * into report_row;
  update public.reviews
  set status='APPROVED_WITH_NOTES',approved_by=auth.uid(),approved_at=now(),
      approval_comment=trim(comment),updated_at=now()
  where id=rid;
  perform public.app_write_audit(
    r.organization_id,'report.approved','report',report_row.id::text,
    'Reviewer approved report content for an explicit Vexim request; not FDA approval',
    jsonb_build_object(
      'result',outcome,'vexim_review_request_id',q.id,
      'label_version_id',q.label_version_id,'artwork_hash',q.artwork_hash
    )
  );
  return to_jsonb(report_row);
end
$$;

-- Never allow report binding fields to be edited after issuance. Existing
-- report snapshots without a request remain legacy records and are not backfilled.
revoke all on function public.app_neutralize_legacy_expert_on_submit() from public,anon,authenticated,service_role;
revoke all on function public.app_vexim_review_request_guard() from public,anon,authenticated,service_role;
revoke all on function public.app_report_vexim_request_guard() from public,anon,authenticated,service_role;
revoke all on function public.app_report_request_binding_immutable() from public,anon,authenticated,service_role;
revoke all on function public.app_editable_vexim_review(uuid) from public,anon,authenticated,service_role;
revoke all on function public.app_report_signoff_snapshot() from public,anon,authenticated,service_role;
revoke all on function public.app_mark_final_report_issued() from public,anon,authenticated,service_role;
revoke all on function public.vexim_create_review_request(uuid) from public,anon,service_role;
revoke all on function public.vexim_start_review_request(uuid) from public,anon,service_role;
revoke all on function public.vexim_approve_report(uuid,uuid,text) from public,anon,service_role;
grant execute on function public.vexim_create_review_request(uuid) to authenticated;
grant execute on function public.vexim_start_review_request(uuid) to authenticated;
grant execute on function public.vexim_approve_report(uuid,uuid,text) to authenticated;

commit;
