-- Dedicated expert-review and approval workflow for FDA guidance documents.
--
-- Why this exists: FDA guidance is NOT a regulation and is NOT legally binding.
-- The eCFR ingestion workflow (0003) covers regulations only; a guidance document
-- ingested or registered manually used to sit in DRAFT with no way to advance it.
-- This migration adds the missing workflow:
--   1. a Regulatory Admin records an expert review (identity, official URL, issue
--      date, hash, guidance status, binding effect, scope, affected rules);
--   2. a DIFFERENT Regulatory Admin approves the source (two-person rule kept).
-- No content, hash or approval is ever fabricated: the review only attests to
-- what a human verified, and approval is refused when any item is missing.
begin;

-- Append-only expert review ledger. One row per review; a new review supersedes
-- the previous one by recency, never by mutation.
create table public.regulatory_guidance_reviews (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.regulatory_sources(id),
  snapshot_id uuid references public.regulatory_snapshots(id),
  source_version integer not null,
  content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'),
  reviewer uuid not null references public.profiles(id),
  guidance_status text not null check(guidance_status in ('final','draft','withdrawn','superseded')),
  binding_effect text not null check(binding_effect in ('non_binding','binding')),
  scope_note text not null check(length(btrim(scope_note)) between 40 and 4000),
  checklist jsonb not null default '{}',
  affected_rules jsonb not null default '[]',
  regression_id uuid references public.regulatory_snapshot_regressions(id),
  created_at timestamptz not null default now()
);
create index guidance_reviews_source on public.regulatory_guidance_reviews(source_id, created_at desc);
create index guidance_reviews_snapshot on public.regulatory_guidance_reviews(snapshot_id) where snapshot_id is not null;
create function public.app_guidance_review_immutable() returns trigger language plpgsql set search_path=public,pg_temp as $$
 begin raise exception 'Expert review records are append-only'; end
$$;
create trigger guidance_review_immutable before update or delete on public.regulatory_guidance_reviews for each row execute function public.app_guidance_review_immutable();
alter table public.regulatory_guidance_reviews enable row level security;
create policy guidance_reviews_read on public.regulatory_guidance_reviews for select to authenticated using(public.app_staff() is not null);

-- Regression runs may now target a manually registered source (no API snapshot).
alter table public.regulatory_snapshot_regressions add column source_id uuid references public.regulatory_sources(id);
alter table public.regulatory_snapshot_regressions alter column snapshot_id drop not null;
alter table public.regulatory_snapshot_regressions add constraint regression_target_exclusive check(num_nonnulls(snapshot_id, source_id)=1);
create index regression_source_target on public.regulatory_snapshot_regressions(source_id, created_at desc) where source_id is not null;

-- Which documents need the dedicated workflow: anything the registry classifies
-- as guidance/guideline. Regulations (CFR, USC, statute) keep the normal path.
create function public.app_is_guidance_document(doc_type text) returns boolean language sql immutable set search_path=public,pg_temp as $$
  select coalesce(doc_type,'') ~* '(guidance|guideline)'
$$;
revoke all on function public.app_is_guidance_document(text) from public,anon,authenticated;
grant execute on function public.app_is_guidance_document(text) to authenticated;

-- ACTIVE rules citing a source directly (source-level counterpart of app_snapshot_rule_refs).
create function public.app_guidance_rule_refs(sid uuid) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'rule_key',r.rule_key,'version',r.version,'definition_hash',r.definition_hash) order by r.id),'[]')
 from public.compliance_rules r where r.status='ACTIVE' and sid=any(r.source_citations)
$$;
revoke all on function public.app_guidance_rule_refs(uuid) from public,anon,authenticated;
grant execute on function public.app_guidance_rule_refs(uuid) to authenticated;

-- Regression for a guidance source. Service role only (the worker/API computes
-- the fixture results; a client may never declare its own regression result).
create function public.vexim_record_guidance_regression(sid uuid,expected_hash text,rule_refs jsonb,test_results jsonb,requester uuid default null) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
 declare s public.regulatory_sources;passed boolean;
 begin perform public.app_require_service();select * into s from public.regulatory_sources where id=sid for update;
 if not found or s.status<>'DRAFT' or s.content_hash is distinct from expected_hash or public.app_guidance_rule_refs(sid) is distinct from rule_refs or test_results is null or jsonb_typeof(test_results) is distinct from 'array' then raise exception 'Fresh affected-rule test and matching source hash required';end if;
 if requester is not null and not exists(select 1 from public.profiles where id=requester and active and staff_role='regulatory_admin') then raise exception 'Regulatory requester required';end if;
 passed:=jsonb_array_length(test_results)=15 and (select count(distinct r->>'rule_key')=15 from jsonb_array_elements(test_results) r) and not exists(select 1 from jsonb_array_elements(test_results) r where r->'passed' is distinct from 'true'::jsonb or r->>'rule_key' not in ('IDENTITY-001','NETQTY-001','INGREDIENT-001','NUTRITION-001','NUTRITION-002','ALLERGEN-001','ALLERGEN-002','CLAIM-001','CLAIM-002','CLAIM-003','FORMULA-001','LABEL-001','LABEL-002','PARTY-001','CLASS-001'));
 insert into public.regulatory_snapshot_regressions(source_id,raw_content_hash,rule_refs,test_results,passed,requested_by) values(sid,expected_hash,rule_refs,test_results,passed,requester);
 perform public.app_write_audit(null,'regulatory.guidance_rules_tested','regulatory_source',sid::text,'Synthetic fixtures evaluated current affected rule definitions; not a legal interpretation check',jsonb_build_object('passed',passed,'affected_rules',jsonb_array_length(rule_refs),'requested_by',requester));
 return jsonb_build_object('passed',passed);end
$$;
revoke all on function public.vexim_record_guidance_regression(uuid,text,jsonb,jsonb,uuid) from public,anon,authenticated;

-- Step 1: expert review attestation by a Regulatory Admin.
create function public.vexim_review_guidance_source(sid uuid,checklist jsonb,guidance_status text,binding_effect text,scope_note text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
 declare s public.regulatory_sources;qa public.regulatory_snapshot_regressions;refs jsonb;rid uuid;critical_alerts integer;
 begin perform public.app_require_staff('regulatory_admin');select * into s from public.regulatory_sources where id=sid for update;
 if not found or s.status<>'DRAFT' or s.approved_by is not null then raise exception 'Only an unapproved draft source can be expert-reviewed';end if;
 if not public.app_is_guidance_document(s.document_type) then raise exception 'Expert review applies to FDA guidance documents only';end if;
 if s.content_hash is null or length(s.content_excerpt)<80 or s.retrieved_at is null then raise exception 'Guidance needs a retrieved snapshot (>=80 chars) and hash before expert review';end if;
 if guidance_status is null or guidance_status not in ('final','draft','withdrawn','superseded') then raise exception 'Classify the guidance status';end if;
 if binding_effect is null or binding_effect not in ('non_binding','binding') then raise exception 'Record whether the guidance is legally binding';end if;
 if scope_note is null or length(btrim(scope_note))<40 then raise exception 'Guidance scope note (at least 40 characters) required';end if;
 if exists(select 1 from unnest(array['document_identity','official_url','issue_date','content_hash','guidance_status','binding_effect','scope','citations_traceable','affected_rules']) k where checklist->>k is distinct from 'true') then raise exception 'Every guidance checklist item must be confirmed';end if;
 if guidance_status='draft' and checklist->>'draft_guidance_ack' is distinct from 'true' then raise exception 'Draft guidance requires an explicit non-binding acknowledgement';end if;
 select count(*) into critical_alerts from public.regulatory_alerts where snapshot_id=s.raw_snapshot_id and severity='critical' and resolved_at is null;
 if critical_alerts>0 and length(btrim(coalesce(checklist->>'override_reason','')))<20 then raise exception 'Critical ingestion alerts require a documented override reason';end if;
 refs:=public.app_guidance_rule_refs(sid);
 if refs<>'[]'::jsonb then
  select * into qa from public.regulatory_snapshot_regressions where source_id=sid order by created_at desc limit 1;
  if not found or not qa.passed or qa.raw_content_hash is distinct from s.content_hash or qa.rule_refs is distinct from refs then raise exception 'Fresh passing regression of affected active rules required';end if;
 end if;
 insert into public.regulatory_guidance_reviews(source_id,snapshot_id,source_version,content_hash,reviewer,guidance_status,binding_effect,scope_note,checklist,affected_rules,regression_id)
  values(sid,s.raw_snapshot_id,s.version,s.content_hash,auth.uid(),guidance_status,binding_effect,btrim(scope_note),coalesce(checklist,'{}'::jsonb),refs,qa.id) returning id into rid;
 if s.raw_snapshot_id is not null then
  update public.regulatory_snapshots set status='REGULATORY_REVIEW',reviewed_by=auth.uid(),review_checklist=coalesce(checklist,'{}'::jsonb),change_classification='interpretation',
   effective_from=coalesce(effective_from,s.effective_from),effective_to=coalesce(effective_to,s.effective_to) where id=s.raw_snapshot_id and status in ('DRAFT','REGULATORY_REVIEW');
 end if;
 perform public.app_write_audit(null,'regulatory.guidance_reviewed','regulatory_source',sid::text,'Expert review recorded for a guidance document',jsonb_build_object('guidance_status',guidance_status,'binding_effect',binding_effect,'version',s.version,'hash',s.content_hash,'affected_rules',jsonb_array_length(refs)));
 return rid;end
$$;
revoke all on function public.vexim_review_guidance_source(uuid,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.vexim_review_guidance_source(uuid,jsonb,text,text,text) to authenticated;

-- Step 2: approval stays independent. Guidance additionally requires the fresh
-- expert review recorded above; the reviewer may not approve their own review.
create or replace function public.vexim_approve_source(sid uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
 declare s public.regulatory_sources;r public.regulatory_guidance_reviews;qa public.regulatory_snapshot_regressions;refs jsonb;
 begin
  perform public.app_require_staff('regulatory_admin');select * into s from public.regulatory_sources where id=sid for update;
  if not found then raise exception 'Source draft required';end if;
  if s.raw_snapshot_id is not null then raise exception 'Approve the entire API snapshot through ingestion workflow';end if;
  if public.app_is_guidance_document(s.document_type) then
   refs:=public.app_guidance_rule_refs(sid);
   select * into r from public.regulatory_guidance_reviews where source_id=sid order by created_at desc limit 1;
   if not found then raise exception 'FDA guidance requires an expert review record before approval';end if;
   if r.source_version<>s.version or r.content_hash is distinct from s.content_hash then raise exception 'Expert review is stale: review the current version and hash again';end if;
   if r.reviewer is null or r.reviewer=auth.uid() then raise exception 'A second Regulatory Admin, not the expert reviewer, must approve this guidance';end if;
   if r.guidance_status not in ('final','draft') then raise exception 'Only final or draft guidance can become current evidence';end if;
   if r.guidance_status='draft' and r.checklist->>'draft_guidance_ack' is distinct from 'true' then raise exception 'Draft guidance needs an explicit non-binding acknowledgement';end if;
   if r.binding_effect is distinct from 'non_binding' then raise exception 'FDA guidance is not legally binding; record it as non-binding';end if;
   if refs<>'[]'::jsonb then
    select * into qa from public.regulatory_snapshot_regressions where source_id=sid order by created_at desc limit 1;
    if not found or not qa.passed or qa.raw_content_hash is distinct from s.content_hash or qa.rule_refs is distinct from refs then raise exception 'Fresh passing regression of affected active rules required';end if;
   end if;
  end if;
  perform public.app_legacy_approve_source(sid);
  if public.app_is_guidance_document(s.document_type) then
   update public.regulatory_sources set ingestion_status='ACTIVE',parser_version=coalesce(parser_version,'vexim-guidance-manual/1.0.0'),updated_at=now() where id=sid;
   perform public.app_write_audit(null,'regulatory.guidance_approved','regulatory_source',sid::text,'Approved guidance after independent expert review',jsonb_build_object('review_id',r.id,'guidance_status',r.guidance_status,'binding_effect',r.binding_effect,'affected_rules',jsonb_array_length(refs)));
  end if;
 end
$$;
revoke all on function public.vexim_approve_source(uuid) from public,anon,authenticated;
grant execute on function public.vexim_approve_source(uuid) to authenticated;
-- The worker/API run as the service role; keep the same grants migration 0003 ends with.
grant all on public.regulatory_guidance_reviews to service_role;
grant execute on all functions in schema public to service_role;
commit;
