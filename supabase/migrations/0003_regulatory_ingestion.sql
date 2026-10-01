-- API-first regulatory knowledge. Additive migration; existing reports remain immutable.
begin;
create table public.regulatory_api_responses (
 id uuid primary key, family text not null check(family in ('ecfr','federal_register')),
 cache_key text not null, api_url text not null check(api_url ~ '^https://www\.(ecfr|federalregister)\.gov/api/'),
 response_status integer not null check(response_status between 100 and 599), headers jsonb not null default '{}',
 content_type text not null, content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'), byte_size integer not null check(byte_size between 0 and 20971520),
 raw_storage_key text not null unique, retrieved_at timestamptz not null, expires_at timestamptz not null, latency_ms integer not null check(latency_ms>=0), validated boolean not null default false
);
create table public.regulatory_request_events(id uuid primary key default gen_random_uuid(),family text not null check(family in ('ecfr','federal_register')),api_url text not null check(api_url ~ '^https://www\.(ecfr|federalregister)\.gov/api/'),response_status integer check(response_status between 100 and 599),error_code text,raw_response_id uuid references public.regulatory_api_responses(id),finished_at timestamptz not null,latency_ms integer not null check(latency_ms>=0));
create index regulatory_requests_finished on public.regulatory_request_events(finished_at desc);
create index regulatory_response_cache on public.regulatory_api_responses(cache_key,retrieved_at desc);
create table public.regulatory_ingestion_jobs (
 id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('ecfr_part101','ecfr_section','ecfr_discovery','fr_monitor')),
 params jsonb not null default '{}',status text not null default 'queued' check(status in ('queued','running','retry','completed','dead_letter')),
 requested_by uuid references public.profiles(id),requested_at timestamptz not null default now(),completed_at timestamptz,
 attempts integer not null default 0 check(attempts between 0 and 3),locked_by text,locked_until timestamptz,next_run_at timestamptz not null default now(),
 response_status integer,error_code text,error_message text,result jsonb not null default '{}'
);
create unique index regulatory_job_dedup on public.regulatory_ingestion_jobs(kind,params) where status in ('queued','running','retry');
create index regulatory_jobs_claim on public.regulatory_ingestion_jobs(status,next_run_at,requested_at);
create table public.regulatory_snapshots (
 id uuid primary key default gen_random_uuid(),source_key text not null,source_family text not null check(source_family in ('ecfr','federal_register')),
 citation text not null,title text not null,api_url text not null,canonical_url text not null check(canonical_url ~ '^https://www\.(ecfr|federalregister)\.gov/'),
 issue_date date,source_version text not null,effective_from date,effective_to date,effective_date_unknown boolean not null default true,
 raw_response_id uuid not null references public.regulatory_api_responses(id), content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'),
 parser_version text not null,status text not null default 'FETCHED' check(status in ('DISCOVERED','FETCHED','PARSED','DRAFT','REGULATORY_REVIEW','APPROVED','ACTIVE','SUPERSEDED','WITHDRAWN','FETCH_FAILED','PARSE_FAILED')),
 retrieved_at timestamptz not null,created_at timestamptz not null default now(),supersedes_snapshot_id uuid references public.regulatory_snapshots(id),
 created_by uuid references public.profiles(id), reviewed_by uuid references public.profiles(id),approved_by uuid references public.profiles(id),approved_at timestamptz,
 validation_results jsonb not null default '{}',review_checklist jsonb not null default '{}',change_classification text,
 chunk_count integer not null default 0,document_number text,metadata jsonb not null default '{}',
 unique(source_key,source_version,content_hash,parser_version),check(effective_to is null or effective_from is null or effective_to>=effective_from)
);
create table public.regulatory_snapshot_observations(snapshot_id uuid not null references public.regulatory_snapshots(id),response_id uuid not null references public.regulatory_api_responses(id),observed_at timestamptz not null,primary key(snapshot_id,response_id));
create table public.regulatory_snapshot_regressions(id uuid primary key default gen_random_uuid(),snapshot_id uuid not null references public.regulatory_snapshots(id),created_at timestamptz not null default clock_timestamp(),raw_content_hash text not null,rule_refs jsonb not null,test_results jsonb not null,passed boolean not null,requested_by uuid references public.profiles(id));
create unique index regulatory_one_active_snapshot on public.regulatory_snapshots(source_key) where status='ACTIVE';
create table public.regulatory_snapshot_sections (
 snapshot_id uuid not null references public.regulatory_snapshots(id),source_id uuid not null references public.regulatory_sources(id),
 section text not null,heading text not null,content text not null,content_hash text not null,topic text not null,reserved boolean not null default false,
 primary key(snapshot_id,section)
);
alter table public.regulatory_sources add column api_url text,add column issue_date date,add column raw_snapshot_id uuid references public.regulatory_snapshots(id),add column raw_content_hash text,add column parser_version text,add column ingestion_status text,add column effective_date_unknown boolean not null default true;
alter table public.regulatory_chunks add column snapshot_id uuid references public.regulatory_snapshots(id),add column chunk_key text unique,add column source_issue_date date,add column source_content_hash text,add column chunk_content_hash text,add column parser_version text,add column paragraph_path text[] not null default '{}',add column citation_precision text not null default 'section' check(citation_precision in ('section','paragraph','unresolved')),add column sequence integer not null default 0,add column source_anchor text,add column topics text[] not null default '{}',add column hierarchy jsonb not null default '[]',add column xml_tag text,add column cross_references text[] not null default '{}';
alter table public.regulatory_chunks add column search_document tsvector generated always as (to_tsvector('english',coalesce(citation,'')||' '||coalesce(heading,'')||' '||content)) stored;
create index regulatory_chunks_fts on public.regulatory_chunks using gin(search_document);
create index regulatory_chunks_snapshot on public.regulatory_chunks(snapshot_id);
create table public.regulatory_alerts (
 id uuid primary key default gen_random_uuid(),snapshot_id uuid references public.regulatory_snapshots(id),job_id uuid references public.regulatory_ingestion_jobs(id),
 code text not null,severity text not null check(severity in ('info','warning','critical')),message text not null,created_at timestamptz not null default now(),resolved_at timestamptz,resolved_by uuid references public.profiles(id),resolution text
);
create table public.regulatory_upstream_limits (family text primary key,next_allowed_at timestamptz not null);
create table public.regulatory_retrieval_metrics(id uuid primary key default gen_random_uuid(),retrieved_at timestamptz not null default now(),hit_count integer not null,actor_id uuid,topic text);

create function public.app_regulatory_immutable() returns trigger language plpgsql set search_path=public,pg_temp as $$
 begin
 if TG_OP='DELETE' then raise exception 'Regulatory snapshots and provenance are immutable'; end if;
 if TG_TABLE_NAME='regulatory_snapshot_regressions' or TG_TABLE_NAME='regulatory_request_events' or TG_TABLE_NAME='regulatory_api_responses' or TG_TABLE_NAME='regulatory_snapshot_sections' or TG_TABLE_NAME='regulatory_snapshot_observations' then raise exception 'Raw provenance and parsed sections are immutable'; end if;
 if TG_TABLE_NAME='regulatory_snapshots' then
 if (to_jsonb(old)-array['status','validation_results','chunk_count','review_checklist','reviewed_by','approved_by','approved_at','effective_from','effective_to','effective_date_unknown','change_classification']) is distinct from (to_jsonb(new)-array['status','validation_results','chunk_count','review_checklist','reviewed_by','approved_by','approved_at','effective_from','effective_to','effective_date_unknown','change_classification']) then raise exception 'Raw snapshot identity is immutable'; end if;
 if old.status not in ('FETCHED','PARSED','PARSE_FAILED') and (old.parser_version is distinct from new.parser_version or old.validation_results is distinct from new.validation_results or old.chunk_count is distinct from new.chunk_count) then raise exception 'Parsed snapshot is immutable'; end if;
 if old.status in ('ACTIVE','SUPERSEDED','WITHDRAWN') and (to_jsonb(old)-'status') is distinct from (to_jsonb(new)-'status') then raise exception 'Approved snapshot metadata is immutable'; end if;
 end if;
 if TG_TABLE_NAME='regulatory_chunks' then if old.snapshot_id is not null then
 if (to_jsonb(old)-array['review_status','approved_by','approved_at','source_version','effective_from','effective_to','embedding','search_document']) is distinct from (to_jsonb(new)-array['review_status','approved_by','approved_at','source_version','effective_from','effective_to','embedding','search_document']) then raise exception 'Chunk text and citation are immutable'; end if;
 end if;end if;return new;end
$$;
create trigger request_event_immutable before update or delete on public.regulatory_request_events for each row execute function public.app_regulatory_immutable();
create trigger raw_response_immutable before update or delete on public.regulatory_api_responses for each row execute function public.app_regulatory_immutable();
create trigger regression_immutable before update or delete on public.regulatory_snapshot_regressions for each row execute function public.app_regulatory_immutable();
create trigger observation_immutable before update or delete on public.regulatory_snapshot_observations for each row execute function public.app_regulatory_immutable();
create trigger snapshot_immutable before update or delete on public.regulatory_snapshots for each row execute function public.app_regulatory_immutable();
create trigger parsed_sections_immutable before update or delete on public.regulatory_snapshot_sections for each row execute function public.app_regulatory_immutable();
create trigger api_chunk_immutable before update or delete on public.regulatory_chunks for each row execute function public.app_regulatory_immutable();

create function public.vexim_request_regulatory_ingestion(job_kind text,job_params jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
 declare j public.regulatory_ingestion_jobs;
 begin
 if coalesce(auth.role(),'')<>'service_role' then perform public.app_require_staff('regulatory_admin'); end if;
 if job_kind is null or job_params is null or job_kind not in ('ecfr_part101','ecfr_section','ecfr_discovery','fr_monitor') or jsonb_typeof(job_params)<>'object' or exists(select 1 from jsonb_object_keys(job_params) k where k not in ('section','term','start_date','end_date','document_type','force_refresh','cfr_part101_only')) then raise exception 'Invalid legal ingestion scope'; end if;
 if job_kind='ecfr_section' and not coalesce(job_params->>'section' ~ '^101\.[0-9]{1,3}$',false) then raise exception 'Part 101 section required'; end if;
 if job_params?'term' and coalesce(job_params->>'term','') not in ('food labeling','nutrition labeling','allergen labeling','tea','21 CFR 101','21 CFR 101.3','21 CFR 101.7','21 CFR 101.9') then raise exception 'Predefined legal queries only; never customer data'; end if;
 if job_kind='fr_monitor' and (not coalesce(job_params->>'start_date' ~ '^\d{4}-\d{2}-\d{2}$' and job_params->>'end_date' ~ '^\d{4}-\d{2}-\d{2}$',false) or (job_params->>'end_date')::date<(job_params->>'start_date')::date or (job_params->>'end_date')::date-(job_params->>'start_date')::date>31) then raise exception 'Federal Register window must be 1-32 calendar days'; end if;
 if job_params?'document_type' and coalesce(job_params->>'document_type','') not in ('RULE','PRORULE','NOTICE') then raise exception 'Invalid document type'; end if;
 if exists(select 1 from unnest(array['force_refresh','cfr_part101_only']) k where job_params?k and jsonb_typeof(job_params->k) is distinct from 'boolean') then raise exception 'Boolean legal flags required';end if;
 perform pg_advisory_xact_lock(hashtext(job_kind||job_params::text));
 select * into j from public.regulatory_ingestion_jobs where kind=job_kind and params=job_params and status in ('queued','running','retry') limit 1;
 if found then return to_jsonb(j); end if;
 insert into public.regulatory_ingestion_jobs(kind,params,requested_by) values(job_kind,job_params,auth.uid()) returning * into j;
 perform public.app_write_audit(null,'regulatory.ingestion_requested','ingestion_job',j.id::text,'Official API ingestion requested',jsonb_build_object('kind',job_kind,'params',job_params));return to_jsonb(j);end
$$;
create function public.vexim_claim_regulatory_ingestion(worker_id text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
 declare j public.regulatory_ingestion_jobs;
 begin perform public.app_require_service();if worker_id is null or length(trim(worker_id))<1 then raise exception 'Worker identity required';end if;
 update public.regulatory_ingestion_jobs set status='dead_letter',error_code='LEASE_EXHAUSTED',error_message='Three ingestion attempts exhausted',locked_by=null,locked_until=null where status='running' and locked_until<now() and attempts>=3;
 insert into public.regulatory_alerts(job_id,code,severity,message) select id,'LEASE_EXHAUSTED','critical','Three expired ingestion leases exhausted' from public.regulatory_ingestion_jobs exhausted where status='dead_letter' and error_code='LEASE_EXHAUSTED' and not exists(select 1 from public.regulatory_alerts a where a.job_id=exhausted.id and a.code='LEASE_EXHAUSTED');
 select * into j from public.regulatory_ingestion_jobs where (status in ('queued','retry') and next_run_at<=now() or status='running' and locked_until<now()) and attempts<3 order by requested_at for update skip locked limit 1;
 if not found then return null;end if;
 update public.regulatory_ingestion_jobs set status='running',attempts=attempts+1,locked_by=worker_id,locked_until=now()+interval '6 minutes' where id=j.id returning * into j;return to_jsonb(j);end
$$;
create function public.vexim_heartbeat_regulatory_ingestion(jid uuid,worker_id text) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
 begin perform public.app_require_service();update public.regulatory_ingestion_jobs set locked_until=now()+interval '6 minutes' where id=jid and locked_by=worker_id and status='running' and locked_until>now();return found;end
$$;
create function public.app_regulatory_lease(jid uuid,worker_id text) returns public.regulatory_ingestion_jobs language plpgsql security definer set search_path=public,pg_temp as $$
 declare j public.regulatory_ingestion_jobs;begin perform public.app_require_service();select * into j from public.regulatory_ingestion_jobs where id=jid and locked_by=worker_id and status='running' and locked_until>now() for update;if not found then raise exception 'Regulatory job lease lost';end if;return j;end
$$;
create function public.vexim_finish_regulatory_ingestion(jid uuid,worker_id text,outcome jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$
 begin perform public.app_regulatory_lease(jid,worker_id);update public.regulatory_ingestion_jobs set status='completed',completed_at=now(),result=outcome,locked_by=null,locked_until=null where id=jid;end
$$;
create function public.vexim_fail_regulatory_ingestion(jid uuid,worker_id text,code text,message text,temporary boolean,retry_after integer default 0) returns void language plpgsql security definer set search_path=public,pg_temp as $$
 declare j public.regulatory_ingestion_jobs;begin j:=public.app_regulatory_lease(jid,worker_id);
 update public.regulatory_ingestion_jobs set status=case when temporary and j.attempts<3 then 'retry' else 'dead_letter' end,error_code=left(code,100),error_message=left(message,2000),next_run_at=now()+make_interval(secs=>greatest(least(retry_after,3600),power(2,j.attempts)::integer)),locked_by=null,locked_until=null,response_status=case when code ~ '^HTTP_[0-9]{3}$' then substring(code from 6)::integer else response_status end where id=jid;
 if code='HTTP_429' and j.attempts<3 and not exists(select 1 from public.regulatory_alerts where job_id=jid and regulatory_alerts.code='HTTP_429') then insert into public.regulatory_alerts(job_id,code,severity,message) values(jid,code,'warning','Upstream returned 429; respecting Retry-After and queue backoff.');end if;
 if not temporary or j.attempts>=3 then update public.regulatory_alerts set severity='critical',message=left(vexim_fail_regulatory_ingestion.message,2000) where job_id=jid and regulatory_alerts.code=vexim_fail_regulatory_ingestion.code and resolved_at is null;if not found then insert into public.regulatory_alerts(job_id,code,severity,message) values(jid,code,'critical',left(message,2000));end if;end if;end
$$;
create function public.vexim_regulatory_rate_limit(source_family text) returns integer language plpgsql security definer set search_path=public,pg_temp as $$
 declare next_time timestamptz;begin perform public.app_require_service();if source_family not in ('ecfr','federal_register') then raise exception 'Invalid upstream';end if;
 insert into public.regulatory_upstream_limits values(source_family,now()) on conflict do nothing;
 select next_allowed_at into next_time from public.regulatory_upstream_limits where family=source_family for update;
 update public.regulatory_upstream_limits set next_allowed_at=greatest(now(),next_time)+interval '1 second' where family=source_family;
 return greatest(0,ceil(extract(epoch from next_time-now())*1000)::integer);end
$$;
create function public.vexim_record_regulatory_snapshot(jid uuid,worker_id text,p jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
 declare j public.regulatory_ingestion_jobs;r public.regulatory_api_responses;s public.regulatory_snapshots;prior public.regulatory_snapshots;revision text;
 begin if p is null or jsonb_typeof(p) is distinct from 'object' then raise exception 'Snapshot metadata required';end if;j:=public.app_regulatory_lease(jid,worker_id);select * into r from public.regulatory_api_responses where id=(p->>'raw_response_id')::uuid;
 if not found or not r.validated or r.response_status<>200 or not exists(select 1 from storage.objects where bucket_id='regulatory-raw' and name=r.raw_storage_key) then raise exception 'Stored valid raw response required';end if;
 if (j.kind='fr_monitor') is distinct from (r.family='federal_register') or (r.family='ecfr' and ((p->>'issue_date') is null or (p->>'issue_date')::date>current_date or p->>'source_version' is distinct from p->>'issue_date')) then raise exception 'Snapshot family/date mismatch';end if;
 revision:=coalesce(p->>'parser_version',case when r.family='ecfr' then 'vexim-ecfr-xml/1.1.0' else 'vexim-fr-metadata/1.0.0' end);if length(revision)<1 then raise exception 'Parser revision required';end if;
 select * into s from public.regulatory_snapshots where source_key=p->>'source_key' and source_version=p->>'source_version' and content_hash=r.content_hash and parser_version=revision;
 if found then insert into public.regulatory_snapshot_observations values(s.id,r.id,r.retrieved_at) on conflict do nothing;return to_jsonb(s);end if;
 select * into prior from public.regulatory_snapshots where source_key=p->>'source_key' and status='ACTIVE';
 insert into public.regulatory_snapshots(source_key,source_family,citation,title,api_url,canonical_url,issue_date,source_version,raw_response_id,content_hash,parser_version,retrieved_at,created_by,supersedes_snapshot_id,document_number,metadata)
 values(p->>'source_key',r.family,p->>'citation',p->>'title',r.api_url,p->>'canonical_url',nullif(p->>'issue_date','')::date,p->>'source_version',r.id,r.content_hash,revision,r.retrieved_at,j.requested_by,prior.id,p->>'document_number',coalesce(p->'metadata','{}')) returning * into s;
 insert into public.regulatory_snapshot_observations values(s.id,r.id,r.retrieved_at);
 if exists(select 1 from public.regulatory_snapshots x where x.id<>s.id and x.source_key=s.source_key and x.source_version=s.source_version and x.content_hash<>s.content_hash) then insert into public.regulatory_alerts(snapshot_id,job_id,code,severity,message) values(s.id,jid,'SAME_ISSUE_HASH_MISMATCH','critical','Raw body changed without an issue/version change. Independent comparison is required.');end if;
 if prior.id is not null and prior.issue_date is distinct from s.issue_date then insert into public.regulatory_alerts(snapshot_id,job_id,code,severity,message) values(s.id,jid,'ISSUE_DATE_CHANGED','info','A new official issue date was discovered; active law and rules are unchanged until approval.');end if;
 perform public.app_write_audit(null,'regulatory.snapshot_fetched','regulatory_snapshot',s.id::text,'Immutable official response registered',jsonb_build_object('raw_hash',s.content_hash,'issue_date',s.issue_date));return to_jsonb(s);end
$$;
create function public.vexim_stage_regulatory_chunks(jid uuid,worker_id text,snapshot_id uuid,section_data jsonb,chunk_data jsonb,validation jsonb) returns void language plpgsql security definer set search_path=public,extensions,pg_temp as $$
 declare j public.regulatory_ingestion_jobs;s public.regulatory_snapshots;x jsonb;c jsonb;sid uuid;ver integer;prior_count integer;
 begin j:=public.app_regulatory_lease(jid,worker_id);select * into s from public.regulatory_snapshots where id=snapshot_id for update;
 if not found or s.source_family<>'ecfr' or s.status not in ('FETCHED','PARSE_FAILED') then raise exception 'Fetched eCFR snapshot required';end if;
 if section_data is null or chunk_data is null or validation is null or jsonb_typeof(section_data) is distinct from 'array' or jsonb_typeof(chunk_data) is distinct from 'array' or jsonb_typeof(validation) is distinct from 'object' or jsonb_array_length(section_data)<1 or validation->>'parser_version' is distinct from s.parser_version or jsonb_array_length(chunk_data)<1 or jsonb_array_length(chunk_data)>20000 or validation->>'coverage_complete' is distinct from 'true' or validation->>'citations_valid' is distinct from 'true' or validation->>'regression_passed' is distinct from 'true' then raise exception 'Parser, citation and regression validation required';end if;
 for x in select * from jsonb_array_elements(section_data) loop
 if x->>'section' !~ '^101\.[0-9]{1,3}$' or length(x->>'content')=0 then raise exception 'Invalid section';end if;
 insert into public.regulatory_sources(source_key,authority,agency,document_type,citation,title,canonical_url,topic,priority,created_by) values('ecfr-'||replace(x->>'section','.','-'),'eCFR','FDA','regulation','21 CFR '||(x->>'section'),x->>'heading','https://www.ecfr.gov/current/title-21/section-'||(x->>'section'),x->>'topic',1,j.requested_by) on conflict(source_key) do nothing;
 select id,version into sid,ver from public.regulatory_sources where source_key='ecfr-'||replace(x->>'section','.','-');
 insert into public.regulatory_snapshot_sections(snapshot_id,source_id,section,heading,content,content_hash,topic,reserved) values(s.id,sid,x->>'section',x->>'heading',x->>'content',encode(extensions.digest(convert_to(x->>'content','UTF8'),'sha256'),'hex'),x->>'topic',coalesce((x->>'reserved')::boolean,false));
 end loop;
 for c in select * from jsonb_array_elements(chunk_data) loop
 select source_id into sid from public.regulatory_snapshot_sections where regulatory_snapshot_sections.snapshot_id=s.id and section=c->>'section';
 if sid is null or c->>'citation' !~ ('^21 CFR '||replace(c->>'section','.','\.')||'(\([a-zA-Z0-9]+\))*$') or length(trim(c->>'content'))=0 then raise exception 'Citation outside parsed snapshot';end if;
 select version into ver from public.regulatory_sources where id=sid;
 insert into public.regulatory_chunks(source_id,source_version,citation,heading,content,topic,obligation_type,snapshot_id,chunk_key,source_issue_date,source_content_hash,chunk_content_hash,parser_version,paragraph_path,citation_precision,sequence,source_anchor,topics,hierarchy,xml_tag,cross_references)
 values(sid,ver+1,c->>'citation',c->>'heading',c->>'content',c->>'topic',c->>'obligation_type',s.id,s.id::text||':'||(c->>'chunk_key'),s.issue_date,s.content_hash,encode(extensions.digest(convert_to(c->>'content','UTF8'),'sha256'),'hex'),validation->>'parser_version',array(select jsonb_array_elements_text(c->'paragraph_path')),c->>'citation_precision',(c->>'sequence')::integer,c->>'source_anchor',array(select jsonb_array_elements_text(c->'topics')),coalesce(c->'hierarchy','[]'),c->>'xml_tag',array(select jsonb_array_elements_text(coalesce(c->'cross_references','[]'))));
 end loop;
 select chunk_count into prior_count from public.regulatory_snapshots where id=s.supersedes_snapshot_id;
 if prior_count>0 and jsonb_array_length(chunk_data)<prior_count*.8 then insert into public.regulatory_alerts(snapshot_id,job_id,code,severity,message) values(s.id,jid,'CHUNK_COUNT_DROP','critical','Parsed chunk count dropped by over 20%; check omissions before activation.');end if;
 update public.regulatory_snapshots set status='DRAFT',parser_version=validation->>'parser_version',validation_results=validation,chunk_count=jsonb_array_length(chunk_data) where id=s.id;
 perform public.app_write_audit(null,'regulatory.snapshot_parsed','regulatory_snapshot',s.id::text,'Draft chunks created; no active index was changed',jsonb_build_object('chunks',jsonb_array_length(chunk_data),'parser_version',validation->>'parser_version'));end
$$;
create function public.vexim_mark_regulatory_parse_failed(jid uuid,worker_id text,snapshot_id uuid,validation jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$
 begin perform public.app_regulatory_lease(jid,worker_id);update public.regulatory_snapshots set status='PARSE_FAILED',validation_results=validation where id=snapshot_id and status='FETCHED';end
$$;
create function public.vexim_stage_federal_register(jid uuid,worker_id text,snapshot_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
 declare s public.regulatory_snapshots;begin perform public.app_regulatory_lease(jid,worker_id);select * into s from public.regulatory_snapshots where id=snapshot_id;
 if not found or s.source_family<>'federal_register' then raise exception 'Federal Register metadata required';end if;
 update public.regulatory_snapshots set status='DRAFT',parser_version='vexim-fr-metadata/1.0.0',validation_results=jsonb_build_object('monitor_only',true) where id=s.id and status='FETCHED';
 if not exists(select 1 from public.regulatory_alerts where regulatory_alerts.snapshot_id=s.id and code in ('NEW_FEDERAL_REGISTER_DOCUMENT','FINAL_RULE_PART101')) then
 insert into public.regulatory_alerts(snapshot_id,job_id,code,severity,message) values(s.id,jid,case when upper(s.metadata->>'type')='RULE' and s.metadata->>'part101'='true' then 'FINAL_RULE_PART101' else 'NEW_FEDERAL_REGISTER_DOCUMENT' end,'warning','New FDA rulemaking document needs regulatory review. Verify the official govinfo edition; no rule was changed.');end if;end
$$;
create function public.app_snapshot_rule_refs(sid uuid) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'rule_key',r.rule_key,'version',r.version,'definition_hash',r.definition_hash) order by r.id),'[]') from public.compliance_rules r where r.status='ACTIVE' and r.source_citations && array(select source_id from public.regulatory_snapshot_sections where snapshot_id=sid)
$$;
revoke all on function public.app_snapshot_rule_refs(uuid) from public,anon,authenticated;
create function public.vexim_record_snapshot_regression(sid uuid,expected_hash text,rule_refs jsonb,test_results jsonb,requester uuid default null) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
 declare s public.regulatory_snapshots;passed boolean;begin perform public.app_require_service();perform pg_advisory_xact_lock(hashtext('vexim:regulatory:active'));select * into s from public.regulatory_snapshots where id=sid;
 if not found or s.status not in ('DRAFT','REGULATORY_REVIEW') or s.source_family<>'ecfr' or s.content_hash is distinct from expected_hash or public.app_snapshot_rule_refs(sid) is distinct from rule_refs or test_results is null or jsonb_typeof(test_results) is distinct from 'array' then raise exception 'Fresh affected-rule test, matching snapshot and definition hashes required';end if;
 if requester is not null and not exists(select 1 from public.profiles where id=requester and active and staff_role='regulatory_admin') then raise exception 'Regulatory requester required';end if;
 passed:=jsonb_array_length(test_results)=15 and (select count(distinct r->>'rule_key')=15 from jsonb_array_elements(test_results) r) and not exists(select 1 from jsonb_array_elements(test_results) r where r->'passed' is distinct from 'true'::jsonb or r->>'rule_key' not in ('IDENTITY-001','NETQTY-001','INGREDIENT-001','NUTRITION-001','NUTRITION-002','ALLERGEN-001','ALLERGEN-002','CLAIM-001','CLAIM-002','CLAIM-003','FORMULA-001','LABEL-001','LABEL-002','PARTY-001','CLASS-001'));
 insert into public.regulatory_snapshot_regressions(snapshot_id,raw_content_hash,rule_refs,test_results,passed,requested_by) values(sid,expected_hash,rule_refs,test_results,passed,requester);
 perform public.app_write_audit(null,'regulatory.affected_rules_tested','regulatory_snapshot',sid::text,'Synthetic fixtures evaluated current affected rule definitions; not a legal interpretation check',jsonb_build_object('passed',passed,'affected_rules',jsonb_array_length(rule_refs),'requested_by',requester));return jsonb_build_object('passed',passed);end
$$;
revoke all on function public.vexim_record_snapshot_regression(uuid,text,jsonb,jsonb,uuid) from public,anon,authenticated;
-- Serialize source activation against publication of a new active rule definition.
alter function public.vexim_approve_rule(uuid) rename to app_legacy_approve_rule;
revoke all on function public.app_legacy_approve_rule(uuid) from public,anon,authenticated;
create function public.vexim_approve_rule(rid uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
 begin perform public.app_require_staff('regulatory_admin');perform pg_advisory_xact_lock(hashtext('vexim:regulatory:active'));perform public.app_legacy_approve_rule(rid);end
$$;
revoke all on function public.vexim_approve_rule(uuid) from public,anon,authenticated;
grant execute on function public.vexim_approve_rule(uuid) to authenticated;
create function public.vexim_review_regulatory_snapshot(sid uuid,expected_hash text,checklist jsonb,classification text,from_date date default null,to_date date default null) returns void language plpgsql security definer set search_path=public,pg_temp as $$
 declare s public.regulatory_snapshots;begin perform public.app_require_staff('regulatory_admin');select * into s from public.regulatory_snapshots where id=sid for update;
 if not found or s.status not in ('DRAFT','REGULATORY_REVIEW') or s.source_family<>'ecfr' or s.content_hash is distinct from expected_hash then raise exception 'Reviewable eCFR draft with matching hash required';end if;
 if classification is null or classification not in ('text_only','interpretation','mandatory_conditions','exemption','claim_criteria','unknown') then raise exception 'Classify the source change';end if;
 if exists(select 1 from unnest(array['api_url','issue_date','source_title','hash','parser_complete','citations_traceable','jurisdiction','affected_rules','effective_date']) k where checklist->>k is distinct from 'true') then raise exception 'Every regulatory checklist item must be confirmed';end if;
 if (from_date is null and checklist->>'unknown_effective_ack' is distinct from 'true') or (to_date is not null and from_date is not null and to_date<from_date) then raise exception 'Effective dates must be verified or explicitly marked unknown';end if;
 if (exists(select 1 from public.regulatory_alerts where snapshot_id=sid and severity='critical' and resolved_at is null) or jsonb_array_length(coalesce(s.validation_results->'warnings','[]'))>0) and length(trim(coalesce(checklist->>'override_reason','')))<20 then raise exception 'Parser/hash alerts require a detailed independent comparison reason';end if;
 update public.regulatory_snapshots set status='REGULATORY_REVIEW',reviewed_by=auth.uid(),review_checklist=checklist||jsonb_build_object('source_baseline',public.app_source_refs(array(select source_id from public.regulatory_snapshot_sections where snapshot_id=sid))),change_classification=classification,effective_from=from_date,effective_to=to_date,effective_date_unknown=from_date is null where id=sid;
 perform public.app_write_audit(null,'regulatory.snapshot_reviewed','regulatory_snapshot',sid::text,'Prepared source activation checklist',jsonb_build_object('classification',classification,'hash',expected_hash));end
$$;
create function public.vexim_activate_regulatory_snapshot(sid uuid,expected_hash text) returns void language plpgsql security definer set search_path=public,extensions,pg_temp as $$
 declare s public.regulatory_snapshots;prior uuid;x public.regulatory_snapshot_sections;oldsource public.regulatory_sources;ver integer;qa public.regulatory_snapshot_regressions;
 begin perform public.app_require_staff('regulatory_admin');perform pg_advisory_xact_lock(hashtext('vexim:regulatory:active'));select * into s from public.regulatory_snapshots where id=sid for update;
 if not found or s.source_family<>'ecfr' or s.status<>'REGULATORY_REVIEW' or s.reviewed_by is null or s.reviewed_by=auth.uid() or s.created_by=auth.uid() or s.content_hash is distinct from expected_hash or s.chunk_count<1 or s.change_classification is null or s.change_classification='unknown' or s.validation_results->>'regression_passed' is distinct from 'true' or s.validation_results->>'coverage_complete' is distinct from 'true' or s.validation_results->>'citations_valid' is distinct from 'true' then raise exception 'Independent activation, valid parser/citations and regression required';end if;
 select * into qa from public.regulatory_snapshot_regressions where snapshot_id=s.id order by created_at desc limit 1;
 if not found or not qa.passed or qa.raw_content_hash is distinct from s.content_hash or qa.rule_refs is distinct from public.app_snapshot_rule_refs(s.id) then raise exception 'Fresh passing regression of affected active rules required';end if;
 if s.issue_date is null or s.issue_date>current_date or s.effective_from>current_date or s.effective_to<current_date then raise exception 'Source is not currently effective';end if;
 perform pg_advisory_xact_lock(hashtext(s.source_key));select id into prior from public.regulatory_snapshots where source_key=s.source_key and status='ACTIVE';
 -- Lock overlapping section rows consistently, including part-vs-section drafts.
 perform 1 from public.regulatory_sources where id in(select source_id from public.regulatory_snapshot_sections where snapshot_id=s.id) order by id for update;
 if s.review_checklist->'source_baseline' is distinct from public.app_source_refs(array(select source_id from public.regulatory_snapshot_sections where snapshot_id=s.id)) then raise exception 'Overlapping source edition changed after checklist; recheck the draft and affected rules';end if;
 if prior is distinct from s.supersedes_snapshot_id then raise exception 'Active edition changed while this draft was prepared; sync and review the new baseline';end if;
 update public.regulatory_snapshots set status='APPROVED',approved_by=auth.uid(),approved_at=now() where id=s.id;
 perform public.app_write_audit(null,'regulatory.snapshot_approved','regulatory_snapshot',s.id::text,'Independent API snapshot approval',jsonb_build_object('hash',s.content_hash));
 if prior is not null then update public.regulatory_snapshots set status='SUPERSEDED' where id=prior;update public.regulatory_chunks set review_status='SUPERSEDED' where snapshot_id=prior;end if;
 for x in select * from public.regulatory_snapshot_sections where snapshot_id=s.id order by section loop
 select * into oldsource from public.regulatory_sources where id=x.source_id for update;
 if oldsource.issue_date>s.issue_date then raise exception 'Cannot downgrade a more recent approved section';end if;
 if oldsource.content_hash is not null then insert into public.regulatory_source_versions(source_id,version,snapshot) values(oldsource.id,oldsource.version,to_jsonb(oldsource)) on conflict do nothing;end if;
 ver:=oldsource.version+1;
 update public.regulatory_chunks set review_status='SUPERSEDED' where source_id=x.source_id and review_status='APPROVED';
 update public.regulatory_sources set version=ver,status='CURRENT',content_excerpt=x.content,content_hash=x.content_hash,api_url=s.api_url,canonical_url='https://www.ecfr.gov/on/'||s.issue_date::text||'/title-21/section-'||x.section,issue_date=s.issue_date,raw_snapshot_id=s.id,raw_content_hash=s.content_hash,parser_version=s.parser_version,ingestion_status='ACTIVE',retrieved_at=s.retrieved_at,effective_from=s.effective_from,effective_to=s.effective_to,effective_date_unknown=s.effective_date_unknown,created_by=s.reviewed_by,approved_by=auth.uid(),approved_at=now(),updated_at=now() where id=x.source_id;
 update public.regulatory_chunks set source_version=ver,review_status='APPROVED',approved_by=auth.uid(),approved_at=now(),effective_from=s.effective_from,effective_to=s.effective_to where snapshot_id=s.id and source_id=x.source_id;
 end loop;
 if prior is not null then insert into public.regulatory_source_versions(source_id,version,snapshot) select id,version,to_jsonb(s0) from public.regulatory_sources s0 where raw_snapshot_id=prior on conflict do nothing;update public.regulatory_sources set status='UNAVAILABLE',ingestion_status='SUPERSEDED' where raw_snapshot_id=prior;end if;
 update public.regulatory_snapshots set status='ACTIVE' where id=s.id;
 -- Published rule definitions remain immutable. Their old source_refs no longer match:
 -- the owner must classify the impact, QA/reapprove a draft before new report issuance.
 perform public.app_write_audit(null,'regulatory.snapshot_activated','regulatory_snapshot',s.id::text,'Active citations switched atomically; affected rule snapshots require QA',jsonb_build_object('issue_date',s.issue_date,'hash',s.content_hash,'supersedes',prior));end
$$;
create function public.vexim_withdraw_regulatory_snapshot(sid uuid,reason text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
 begin perform public.app_require_staff('regulatory_admin');if reason is null or length(trim(reason))<20 then raise exception 'Withdrawal reason required';end if;
 update public.regulatory_snapshots set status='WITHDRAWN' where id=sid and status='ACTIVE';if not found then raise exception 'Only an active snapshot can be withdrawn';end if;
 update public.regulatory_sources set status='UNAVAILABLE',ingestion_status='WITHDRAWN' where raw_snapshot_id=sid;
 update public.regulatory_chunks set review_status='SUPERSEDED' where snapshot_id=sid;
 perform public.app_write_audit(null,'regulatory.snapshot_withdrawn','regulatory_snapshot',sid::text,reason);end
$$;
create function public.vexim_resolve_regulatory_alert(aid uuid,reason text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
 begin perform public.app_require_staff('regulatory_admin');if reason is null or length(trim(reason))<20 then raise exception 'Detailed regulatory review reason required';end if;
 update public.regulatory_alerts set resolved_at=now(),resolved_by=auth.uid(),resolution=reason where id=aid and resolved_at is null;if not found then raise exception 'Open regulatory alert required';end if;
 perform public.app_write_audit(null,'regulatory.alert_resolved','regulatory_alert',aid::text,reason);end
$$;

create function public.vexim_log_regulatory_response_access(rid uuid,purpose text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
 begin if coalesce(auth.role(),'')<>'service_role' then perform public.app_require_staff('regulatory_admin');end if;if purpose is null or purpose not in ('raw_download','cache_read') or not exists(select 1 from public.regulatory_api_responses where id=rid) then raise exception 'Registered raw response and valid access purpose required';end if;perform public.app_write_audit(null,'regulatory.'||case when purpose='cache_read' then 'raw_cache_read' else 'raw_download' end,'regulatory_response',rid::text,'Private regulatory raw body access authorized',jsonb_build_object('purpose',purpose));end
$$;
revoke all on function public.vexim_log_regulatory_response_access(uuid,text) from public,anon,authenticated;
grant execute on function public.vexim_log_regulatory_response_access(uuid,text) to authenticated;
create function public.vexim_log_regulatory_raw_access(sid uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
 begin if coalesce(auth.role(),'')<>'service_role' then perform public.app_require_staff('regulatory_admin');end if;if not exists(select 1 from public.regulatory_snapshots where id=sid) then raise exception 'Unknown raw snapshot';end if;perform public.app_write_audit(null,'regulatory.raw_download','regulatory_snapshot',sid::text,'Granted a five-minute private raw response URL');end
$$;
revoke all on function public.vexim_log_regulatory_raw_access(uuid) from public,anon,authenticated;
grant execute on function public.vexim_log_regulatory_raw_access(uuid) to authenticated;
-- Existing manual FDA/guidance workflow remains available, but cannot replace API provenance.
alter function public.vexim_save_source(jsonb) rename to app_legacy_save_source;
alter function public.vexim_approve_source(uuid) rename to app_legacy_approve_source;
revoke all on function public.app_legacy_save_source(jsonb),public.app_legacy_approve_source(uuid) from public,anon,authenticated;
create function public.vexim_save_source(p jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
 begin perform public.app_require_staff('regulatory_admin');if exists(select 1 from public.regulatory_sources where id=nullif(p->>'id','')::uuid and raw_snapshot_id is not null) then raise exception 'API-backed source must use ingestion/approval workflow';end if;return public.app_legacy_save_source(p);end
$$;
create function public.vexim_approve_source(sid uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
 begin perform public.app_require_staff('regulatory_admin');if exists(select 1 from public.regulatory_sources where id=sid and raw_snapshot_id is not null) then raise exception 'Approve the entire API snapshot through ingestion workflow';end if;perform public.app_legacy_approve_source(sid);end
$$;
create or replace function public.app_source_current(s public.regulatory_sources) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select s.status='CURRENT' and s.content_hash is not null and s.approved_by is not null and (s.effective_from is null or s.effective_from<=current_date) and (s.effective_to is null or s.effective_to>=current_date) and (s.raw_snapshot_id is null or exists(select 1 from public.regulatory_snapshots x where x.id=s.raw_snapshot_id and s.ingestion_status='ACTIVE' and x.status='ACTIVE' and x.content_hash=s.raw_content_hash and x.issue_date=s.issue_date and x.issue_date<=current_date))
$$;
create function public.vexim_retrieve_regulatory(question text,topic_filter text,scope_filter text,as_of_date date,authorities text[] default array['eCFR','FDA'],match_count integer default 5) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
 declare results jsonb;begin
 if coalesce(auth.role(),'')<>'service_role' and (not public.app_is_active() or public.app_staff() is null) then raise exception 'Staff regulatory retrieval required' using errcode='42501';end if;
 if question is null or length(trim(question))<3 or length(question)>2000 or topic_filter is null or scope_filter is null or as_of_date is null or authorities is null or cardinality(authorities)=0 or not authorities <@ array['eCFR','FDA']::text[] or scope_filter not in ('dry_packaged_tea','tea_bag') or as_of_date>current_date then raise exception 'Invalid scoped retrieval';end if;
 select coalesce(jsonb_agg(rowdata),'[]') into results from (
 select jsonb_build_object('chunk_id',c.id,'source_id',s.id,'snapshot_id',x.id,'citation',c.citation,'source_title',s.title,'source_version',x.source_version,'registry_version',s.version,'source_status','ACTIVE','text',left(c.content,6000),'truncated',length(c.content)>6000,'canonical_url',c.source_anchor,'api_url',s.api_url,'issue_date',s.issue_date,'retrieved_at',s.retrieved_at,'content_hash',x.content_hash,'chunk_content_hash',c.chunk_content_hash,'parser_version',c.parser_version,'topic',c.topic,'jurisdiction','US_FEDERAL','retrieval_method','full_text','effective_date_unknown',x.effective_date_unknown) rowdata
 from public.regulatory_chunks c join public.regulatory_sources s on s.id=c.source_id join public.regulatory_snapshots x on x.id=c.snapshot_id
 where x.status='ACTIVE' and s.ingestion_status='ACTIVE' and s.status='CURRENT' and s.raw_snapshot_id=x.id and s.raw_content_hash=x.content_hash and s.issue_date=x.issue_date and c.review_status='APPROVED' and c.source_version=s.version and s.authority=any(authorities) and c.jurisdiction='US' and c.language='en' and c.applies_to ? scope_filter and (c.topic=topic_filter or topic_filter=any(c.topics)) and x.issue_date<=as_of_date and (x.effective_from is null or x.effective_from<=as_of_date) and (x.effective_to is null or x.effective_to>=as_of_date) and c.citation_precision<>'unresolved' and c.search_document @@ websearch_to_tsquery('english',question)
 order by ts_rank(c.search_document,websearch_to_tsquery('english',question)) desc,c.sequence desc limit least(greatest(match_count,1),4)
 ) q;
 insert into public.regulatory_retrieval_metrics(hit_count,actor_id,topic) values(jsonb_array_length(results),auth.uid(),topic_filter);return results;end
$$;

create function public.vexim_retrieve_regulatory_vector(query_embedding extensions.vector(768),topic_filter text,scope_filter text,as_of_date date,authorities text[] default array['eCFR','FDA'],match_count integer default 5) returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
 declare results jsonb;begin
 if coalesce(auth.role(),'')<>'service_role' and (not public.app_is_active() or public.app_staff() is null) then raise exception 'Staff regulatory retrieval required' using errcode='42501';end if;
 if query_embedding is null or topic_filter is null or scope_filter is null or as_of_date is null or authorities is null or cardinality(authorities)=0 or not authorities <@ array['eCFR','FDA']::text[] or scope_filter not in ('dry_packaged_tea','tea_bag') or as_of_date>current_date then raise exception 'Invalid scoped retrieval';end if;
 select coalesce(jsonb_agg(rowdata),'[]') into results from (
 select jsonb_build_object('chunk_id',c.id,'source_id',s.id,'snapshot_id',x.id,'citation',c.citation,'source_title',s.title,'source_version',x.source_version,'registry_version',s.version,'source_status','ACTIVE','text',left(c.content,6000),'truncated',length(c.content)>6000,'canonical_url',c.source_anchor,'api_url',s.api_url,'issue_date',s.issue_date,'retrieved_at',s.retrieved_at,'content_hash',x.content_hash,'chunk_content_hash',c.chunk_content_hash,'parser_version',c.parser_version,'topic',c.topic,'jurisdiction','US_FEDERAL','retrieval_method','vector','similarity',1-(c.embedding<=>query_embedding),'effective_date_unknown',x.effective_date_unknown) rowdata
 from public.regulatory_chunks c join public.regulatory_sources s on s.id=c.source_id join public.regulatory_snapshots x on x.id=c.snapshot_id
 where x.status='ACTIVE' and s.ingestion_status='ACTIVE' and s.status='CURRENT' and s.raw_snapshot_id=x.id and s.raw_content_hash=x.content_hash and s.issue_date=x.issue_date and c.review_status='APPROVED' and c.source_version=s.version and s.authority=any(authorities) and c.jurisdiction='US' and c.language='en' and c.applies_to ? scope_filter and (c.topic=topic_filter or topic_filter=any(c.topics)) and x.issue_date<=as_of_date and (x.effective_from is null or x.effective_from<=as_of_date) and (x.effective_to is null or x.effective_to>=as_of_date) and c.citation_precision<>'unresolved' and c.embedding is not null
 order by c.embedding<=>query_embedding,c.sequence desc limit least(greatest(match_count,1),4)
 ) q;
 insert into public.regulatory_retrieval_metrics(hit_count,actor_id,topic) values(jsonb_array_length(results),auth.uid(),topic_filter);return results;end
$$;

revoke all on function public.vexim_retrieve_regulatory_vector(extensions.vector,text,text,date,text[],integer) from public,anon,authenticated;
grant execute on function public.vexim_retrieve_regulatory_vector(extensions.vector,text,text,date,text[],integer) to authenticated;
-- Legacy adapter remains scoped to current approved evidence, with unresolved/API-stale chunks excluded.
create or replace function public.vexim_match_regulatory_chunks(query_embedding extensions.vector(768),topic_filter text,category_filter text,match_count integer default 5) returns table(id uuid,citation text,content text,source_id uuid,source_version integer,content_hash text,similarity float) language sql stable security invoker set search_path=public,extensions,pg_temp as $$
 select c.id,c.citation,left(c.content,6000),s.id,s.version,s.content_hash,1-(c.embedding<=>query_embedding) from public.regulatory_chunks c join public.regulatory_sources s on s.id=c.source_id
 where public.app_staff() is not null and public.app_source_current(s) and c.source_version=s.version and c.review_status='APPROVED' and c.citation_precision<>'unresolved' and ((s.raw_snapshot_id is null and c.snapshot_id is null) or c.snapshot_id=s.raw_snapshot_id) and c.jurisdiction='US' and c.language='en' and c.topic=topic_filter and c.applies_to ? category_filter and c.embedding is not null and (c.effective_from is null or c.effective_from<=current_date) and (c.effective_to is null or c.effective_to>=current_date)
 order by c.embedding<=>query_embedding limit least(greatest(match_count,1),4)
$$;

-- Operational aggregates are not silently capped by the dashboard list pagination.
create function public.vexim_regulatory_dashboard_metrics() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
 declare result jsonb;begin if not public.app_is_active() or public.app_staff() is null then raise exception 'Staff metrics required' using errcode='42501';end if;
 select jsonb_build_object('requests',count(*),'failures',count(*) filter(where error_code is not null),'rate_limited',count(*) filter(where response_status=429),'mean_latency_ms',coalesce(round(avg(latency_ms)),0)) into result from public.regulatory_request_events where finished_at>=now()-interval '24 hours';
 result:=result||jsonb_build_object('parse_failures',(select count(*) from public.regulatory_snapshots where status='PARSE_FAILED'),'pending_approval',(select count(*) from public.regulatory_snapshots where status in ('DRAFT','REGULATORY_REVIEW')),'active_age_days',(select max(floor(extract(epoch from now()-coalesce((select max(o.observed_at) from public.regulatory_snapshot_observations o where o.snapshot_id=s.id),s.retrieved_at))/86400)) from public.regulatory_snapshots s where status='ACTIVE'),'retrieval_requests',(select count(*) from public.regulatory_retrieval_metrics where retrieved_at>=now()-interval '24 hours'),'retrieval_hits',(select count(*) from public.regulatory_retrieval_metrics where retrieved_at>=now()-interval '24 hours' and hit_count>0));return result;end
$$;
revoke all on function public.vexim_regulatory_dashboard_metrics() from public,anon,authenticated;
grant execute on function public.vexim_regulatory_dashboard_metrics() to authenticated;
create table public.regulatory_schedule_state(slot text primary key,last_enqueued_date date not null);
alter table public.regulatory_schedule_state enable row level security;
grant all on public.regulatory_schedule_state to service_role;
-- Call daily (or let the dedicated worker call it with --schedule). UTC calendar slot is idempotent.
create function public.vexim_schedule_regulatory_sync() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
 declare term text;result jsonb:='[]';job jsonb;begin perform public.app_require_service();perform pg_advisory_xact_lock(hashtext('vexim:regulatory:daily'));
 if exists(select 1 from public.regulatory_schedule_state where slot='daily' and last_enqueued_date=current_date) then return result;end if;
 job:=public.vexim_request_regulatory_ingestion('ecfr_part101',jsonb_build_object('force_refresh',true));result:=result||jsonb_build_array(job->>'id');
 foreach term in array array['food labeling','nutrition labeling','allergen labeling','tea','21 CFR 101','21 CFR 101.3','21 CFR 101.7','21 CFR 101.9'] loop
 job:=public.vexim_request_regulatory_ingestion('fr_monitor',jsonb_build_object('term',term,'start_date',(current_date-2)::text,'end_date',current_date::text));result:=result||jsonb_build_array(job->>'id');end loop;
 insert into public.regulatory_alerts(snapshot_id,code,severity,message) select id,'ACTIVE_SOURCE_STALE','warning','Active snapshot is older than 30 days; perform a fresh sync and regulatory verification. Rules were not changed.' from public.regulatory_snapshots s where status='ACTIVE' and coalesce((select max(o.observed_at) from public.regulatory_snapshot_observations o where o.snapshot_id=s.id),s.retrieved_at)<now()-interval '30 days' and not exists(select 1 from public.regulatory_alerts a where a.snapshot_id=s.id and a.code='ACTIVE_SOURCE_STALE' and resolved_at is null);
 insert into public.regulatory_schedule_state values('daily',current_date) on conflict(slot) do update set last_enqueued_date=excluded.last_enqueued_date;return result;end
$$;
revoke all on function public.vexim_schedule_regulatory_sync() from public,anon,authenticated;
-- RLS and Storage: raw bodies ONLY Regulatory Admin/service, not reviewer/system/customer.
do $$ declare t text;begin foreach t in array array['regulatory_api_responses','regulatory_request_events','regulatory_ingestion_jobs','regulatory_snapshots','regulatory_snapshot_sections','regulatory_snapshot_observations','regulatory_snapshot_regressions','regulatory_alerts','regulatory_upstream_limits','regulatory_retrieval_metrics'] loop execute format('alter table public.%I enable row level security',t);end loop;end $$;
create policy regulatory_raw_metadata_read on public.regulatory_api_responses for select to authenticated using(public.app_staff()='regulatory_admin');
create policy regulatory_jobs_read on public.regulatory_ingestion_jobs for select to authenticated using(public.app_staff() is not null);
create policy regulatory_snapshots_read on public.regulatory_snapshots for select to authenticated using(public.app_staff() is not null);
create policy regulatory_sections_read on public.regulatory_snapshot_sections for select to authenticated using(public.app_staff() is not null);
create policy regulatory_regressions_read on public.regulatory_snapshot_regressions for select to authenticated using(public.app_staff() is not null);
create policy regulatory_observations_read on public.regulatory_snapshot_observations for select to authenticated using(public.app_staff() is not null);
create policy regulatory_alerts_read on public.regulatory_alerts for select to authenticated using(public.app_staff() is not null);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('regulatory-raw','regulatory-raw',false,20971520,array['application/json','application/xml','text/xml','application/octet-stream']) on conflict(id) do update set public=false;
create policy regulatory_raw_read on storage.objects for select to authenticated using(bucket_id='regulatory-raw' and public.app_staff()='regulatory_admin' and exists(select 1 from public.regulatory_api_responses r where r.raw_storage_key=storage.objects.name));
grant select on public.regulatory_api_responses,public.regulatory_ingestion_jobs,public.regulatory_snapshots,public.regulatory_snapshot_sections,public.regulatory_snapshot_observations,public.regulatory_snapshot_regressions,public.regulatory_alerts to authenticated;
grant all on public.regulatory_request_events,public.regulatory_api_responses,public.regulatory_ingestion_jobs,public.regulatory_snapshots,public.regulatory_snapshot_sections,public.regulatory_snapshot_observations,public.regulatory_snapshot_regressions,public.regulatory_alerts,public.regulatory_upstream_limits,public.regulatory_retrieval_metrics to service_role;
revoke all on function public.app_regulatory_immutable(),public.app_regulatory_lease(uuid,text),public.vexim_request_regulatory_ingestion(text,jsonb),public.vexim_claim_regulatory_ingestion(text),public.vexim_heartbeat_regulatory_ingestion(uuid,text),public.vexim_finish_regulatory_ingestion(uuid,text,jsonb),public.vexim_fail_regulatory_ingestion(uuid,text,text,text,boolean,integer),public.vexim_regulatory_rate_limit(text),public.vexim_record_regulatory_snapshot(uuid,text,jsonb),public.vexim_stage_regulatory_chunks(uuid,text,uuid,jsonb,jsonb,jsonb),public.vexim_mark_regulatory_parse_failed(uuid,text,uuid,jsonb),public.vexim_stage_federal_register(uuid,text,uuid),public.vexim_review_regulatory_snapshot(uuid,text,jsonb,text,date,date),public.vexim_activate_regulatory_snapshot(uuid,text),public.vexim_withdraw_regulatory_snapshot(uuid,text),public.vexim_resolve_regulatory_alert(uuid,text),public.vexim_save_source(jsonb),public.vexim_approve_source(uuid),public.vexim_retrieve_regulatory(text,text,text,date,text[],integer) from public,anon,authenticated;
grant execute on function public.vexim_request_regulatory_ingestion(text,jsonb),public.vexim_review_regulatory_snapshot(uuid,text,jsonb,text,date,date),public.vexim_activate_regulatory_snapshot(uuid,text),public.vexim_withdraw_regulatory_snapshot(uuid,text),public.vexim_resolve_regulatory_alert(uuid,text),public.vexim_save_source(jsonb),public.vexim_approve_source(uuid),public.vexim_retrieve_regulatory(text,text,text,date,text[],integer) to authenticated;
grant execute on all functions in schema public to service_role;
commit;
