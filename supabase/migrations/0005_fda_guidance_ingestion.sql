-- FDA Guidance is stored as immutable raw HTML/PDF and review-only DRAFT evidence.
-- This migration does not activate sources, chunks, snapshots, rules, or schedulers.
begin;

alter table public.regulatory_api_responses
  drop constraint if exists regulatory_api_responses_family_check,
  drop constraint if exists regulatory_api_responses_api_url_check;
alter table public.regulatory_api_responses
  add constraint regulatory_api_responses_family_check
    check (family in ('ecfr','federal_register','fda_guidance')),
  add constraint regulatory_api_responses_api_url_check
    check (
      (family='ecfr' and api_url like 'https://www.ecfr.gov/api/%') or
      (family='federal_register' and api_url like 'https://www.federalregister.gov/api/%') or
      (family='fda_guidance' and api_url in (
        'https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/label-claims-conventional-foods-and-dietary-supplements',
        'https://www.fda.gov/files/food/published/Food-Labeling-Guide-%28PDF%29.pdf'
      ))
    );

alter table public.regulatory_request_events
  drop constraint if exists regulatory_request_events_family_check,
  drop constraint if exists regulatory_request_events_api_url_check;
alter table public.regulatory_request_events
  add constraint regulatory_request_events_family_check
    check (family in ('ecfr','federal_register','fda_guidance')),
  add constraint regulatory_request_events_api_url_check
    check (
      (family='ecfr' and api_url like 'https://www.ecfr.gov/api/%') or
      (family='federal_register' and api_url like 'https://www.federalregister.gov/api/%') or
      (family='fda_guidance' and api_url in (
        'https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/label-claims-conventional-foods-and-dietary-supplements',
        'https://www.fda.gov/files/food/published/Food-Labeling-Guide-%28PDF%29.pdf'
      ))
    );

alter table public.regulatory_ingestion_jobs
  drop constraint if exists regulatory_ingestion_jobs_kind_check;
alter table public.regulatory_ingestion_jobs
  add constraint regulatory_ingestion_jobs_kind_check
    check (kind in (
      'ecfr_part101','ecfr_section','ecfr_discovery','fr_monitor',
      'fda_label_claims_html','fda_food_label_guide_pdf'
    ));

alter table public.regulatory_snapshots
  drop constraint if exists regulatory_snapshots_source_family_check,
  drop constraint if exists regulatory_snapshots_canonical_url_check,
  drop constraint if exists regulatory_snapshots_api_url_fda_check;
alter table public.regulatory_snapshots
  add constraint regulatory_snapshots_source_family_check
    check (source_family in ('ecfr','federal_register','fda_guidance')),
  add constraint regulatory_snapshots_canonical_url_check
    check (
      (source_family in ('ecfr','federal_register') and (canonical_url like 'https://www.ecfr.gov/%' or canonical_url like 'https://www.federalregister.gov/%')) or
      (source_family='fda_guidance' and canonical_url in (
        'https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/label-claims-conventional-foods-and-dietary-supplements',
        'https://www.fda.gov/files/food/published/Food-Labeling-Guide-%28PDF%29.pdf'
      ))
    ),
  add constraint regulatory_snapshots_api_url_fda_check
    check (
      source_family<>'fda_guidance' or api_url in (
        'https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/label-claims-conventional-foods-and-dietary-supplements',
        'https://www.fda.gov/files/food/published/Food-Labeling-Guide-%28PDF%29.pdf'
      )
    );

alter table public.regulatory_sources
  add column if not exists document_revision_date date,
  add column if not exists document_revision_label text;
alter table public.regulatory_snapshots
  add column if not exists document_revision_date date,
  add column if not exists document_revision_label text;
alter table public.regulatory_chunks
  drop constraint if exists regulatory_chunks_citation_precision_check;
alter table public.regulatory_chunks
  add constraint regulatory_chunks_citation_precision_check
    check (citation_precision in ('section','paragraph','heading','page','unresolved'));

update storage.buckets
set allowed_mime_types = array_append(
  array_append(allowed_mime_types,'text/html'),
  'application/pdf'
)
where id='regulatory-raw'
  and not ('text/html'=any(allowed_mime_types))
  and not ('application/pdf'=any(allowed_mime_types));
update storage.buckets
set allowed_mime_types = array_append(allowed_mime_types,'text/html')
where id='regulatory-raw'
  and not ('text/html'=any(allowed_mime_types));
update storage.buckets
set allowed_mime_types = array_append(allowed_mime_types,'application/pdf')
where id='regulatory-raw'
  and not ('application/pdf'=any(allowed_mime_types));
update storage.buckets
set allowed_mime_types = array_append(allowed_mime_types,'application/xhtml+xml')
where id='regulatory-raw'
  and not ('application/xhtml+xml'=any(allowed_mime_types));

create or replace function public.vexim_request_regulatory_ingestion(job_kind text,job_params jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
 declare j public.regulatory_ingestion_jobs;
 begin
 if coalesce(auth.role(),'')<>'service_role' then perform public.app_require_staff('regulatory_admin');end if;
 if job_kind is null or job_params is null or job_kind not in ('ecfr_part101','ecfr_section','ecfr_discovery','fr_monitor','fda_label_claims_html','fda_food_label_guide_pdf') or jsonb_typeof(job_params)<>'object' or exists(select 1 from jsonb_object_keys(job_params) k where k not in ('section','term','start_date','end_date','document_type','force_refresh','cfr_part101_only')) then raise exception 'Invalid legal ingestion scope'; end if;
 if job_kind='fda_label_claims_html' and exists(select 1 from jsonb_object_keys(job_params) k where k<>'force_refresh') then raise exception 'FDA HTML ingestion accepts only force_refresh';end if;
 if job_kind='fda_food_label_guide_pdf' and exists(select 1 from jsonb_object_keys(job_params) k where k<>'force_refresh') then raise exception 'FDA PDF ingestion accepts only force_refresh';end if;
 if job_kind='ecfr_section' and not coalesce(job_params->>'section' ~ '^101[.][0-9]{1,3}$',false) then raise exception 'Part 101 section required'; end if;
 if job_params?'term' and coalesce(job_params->>'term','') not in ('food labeling','nutrition labeling','allergen labeling','tea','21 CFR 101','21 CFR 101.3','21 CFR 101.7','21 CFR 101.9') then raise exception 'Predefined legal queries only; never customer data'; end if;
 if job_kind='fr_monitor' and (not coalesce(job_params->>'start_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and job_params->>'end_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$',false) or (job_params->>'end_date')::date<(job_params->>'start_date')::date or (job_params->>'end_date')::date-(job_params->>'start_date')::date>31) then raise exception 'Federal Register window must be 1-32 calendar days'; end if;
 if job_params?'document_type' and coalesce(job_params->>'document_type','') not in ('RULE','PRORULE','NOTICE') then raise exception 'Invalid document type'; end if;
 if exists(select 1 from unnest(array['force_refresh','cfr_part101_only']) k where job_params?k and jsonb_typeof(job_params->k) is distinct from 'boolean') then raise exception 'Boolean legal flags required';end if;
 perform pg_advisory_xact_lock(hashtext(job_kind||job_params::text));
 select * into j from public.regulatory_ingestion_jobs where kind=job_kind and params=job_params and status in ('queued','running','retry') limit 1;
 if found then return to_jsonb(j); end if;
 insert into public.regulatory_ingestion_jobs(kind,params,requested_by) values(job_kind,job_params,auth.uid()) returning * into j;
 perform public.app_write_audit(null,'regulatory.ingestion_requested','ingestion_job',j.id::text,'Official source ingestion requested',jsonb_build_object('kind',job_kind,'params',job_params));return to_jsonb(j);end
$$;

create or replace function public.vexim_regulatory_rate_limit(source_family text) returns integer language plpgsql security definer set search_path=public,pg_temp as $$
 declare next_time timestamptz;begin perform public.app_require_service();if source_family not in ('ecfr','federal_register','fda_guidance') then raise exception 'Invalid upstream';end if;
 insert into public.regulatory_upstream_limits values(source_family,now()) on conflict do nothing;
 select next_allowed_at into next_time from public.regulatory_upstream_limits where family=source_family for update;
 update public.regulatory_upstream_limits set next_allowed_at=greatest(now(),next_time)+interval '1 second' where family=source_family;
 return greatest(0,ceil(extract(epoch from next_time-now())*1000)::integer);end
$$;

create or replace function public.vexim_record_regulatory_snapshot(jid uuid,worker_id text,p jsonb) returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
 declare j public.regulatory_ingestion_jobs;r public.regulatory_api_responses;s public.regulatory_snapshots;prior public.regulatory_snapshots;revision text;expected_key text;expected_url text;expected_citation text;expected_title text;
 begin
 if p is null or jsonb_typeof(p) is distinct from 'object' then raise exception 'Snapshot metadata required';end if;
 j:=public.app_regulatory_lease(jid,worker_id);
 select * into r from public.regulatory_api_responses where id=(p->>'raw_response_id')::uuid;
 if not found or not r.validated or r.response_status<>200 or not exists(select 1 from storage.objects where bucket_id='regulatory-raw' and name=r.raw_storage_key) then raise exception 'Stored valid raw response required';end if;
 if (j.kind in ('ecfr_part101','ecfr_section','ecfr_discovery')) is distinct from (r.family='ecfr') or (j.kind='fr_monitor') is distinct from (r.family='federal_register') or (j.kind in ('fda_label_claims_html','fda_food_label_guide_pdf')) is distinct from (r.family='fda_guidance') then raise exception 'Snapshot family/job mismatch';end if;
 if r.family='ecfr' and ((p->>'issue_date') is null or (p->>'issue_date')::date>current_date or p->>'source_version' is distinct from p->>'issue_date') then raise exception 'eCFR issue date mismatch';end if;
 if r.family='fda_guidance' then
   if j.kind='fda_label_claims_html' then
     expected_key:='fda-label-claims';expected_url:='https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/label-claims-conventional-foods-and-dietary-supplements';expected_citation:='FDA Label Claims Guidance';expected_title:='Label claims for conventional foods and dietary supplements';
     if r.content_type not ilike 'text/html%' and r.content_type not ilike 'application/xhtml+xml%' then raise exception 'FDA HTML MIME type required';end if;
     if p->'metadata'->>'format' is distinct from 'HTML' or p->>'parser_version' not like 'vexim-fda-html/%' then raise exception 'FDA HTML parser metadata required';end if;
   else
     expected_key:='fda-food-label-guide';expected_url:='https://www.fda.gov/files/food/published/Food-Labeling-Guide-%28PDF%29.pdf';expected_citation:='FDA Food Labeling Guide';expected_title:='A Food Labeling Guide';
     if r.content_type not ilike 'application/pdf%' then raise exception 'FDA PDF MIME type required';end if;
     if p->'metadata'->>'format' is distinct from 'PDF' or p->>'parser_version' not like 'vexim-fda-pdf/%' then raise exception 'FDA PDF parser metadata required';end if;
   end if;
   if p->>'source_key' is distinct from expected_key or p->>'canonical_url' is distinct from expected_url or r.api_url is distinct from expected_url or p->>'citation' is distinct from expected_citation or p->>'title' is distinct from expected_title or nullif(p->>'issue_date','') is not null then raise exception 'FDA source allowlist metadata mismatch';end if;
   if not exists(select 1 from public.regulatory_sources x where x.source_key=expected_key and x.authority='FDA' and x.agency='FDA' and x.document_type='guidance' and x.canonical_url=expected_url and x.status='DRAFT') then raise exception 'Registered FDA Guidance source must remain DRAFT';end if;
   if p->>'document_revision_date' is not null and p->>'document_revision_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Invalid FDA document revision date';end if;
   if length(coalesce(p->>'document_revision_label',''))>200 then raise exception 'FDA revision label exceeds its size limit';end if;
 end if;
 if length(coalesce(p->>'source_version',''))<1 or length(p->>'source_version')>160 then raise exception 'Snapshot source version required';end if;
 revision:=coalesce(p->>'parser_version',case when r.family='ecfr' then 'vexim-ecfr-xml/1.1.0' else 'vexim-fr-metadata/1.0.0' end);if length(revision)<1 then raise exception 'Parser revision required';end if;
 select * into s from public.regulatory_snapshots where source_key=p->>'source_key' and source_version=p->>'source_version' and content_hash=r.content_hash and parser_version=revision;
 if found then insert into public.regulatory_snapshot_observations values(s.id,r.id,r.retrieved_at) on conflict do nothing;return to_jsonb(s);end if;
 select * into prior from public.regulatory_snapshots where source_key=p->>'source_key' and status='ACTIVE';
 insert into public.regulatory_snapshots(source_key,source_family,citation,title,api_url,canonical_url,issue_date,document_revision_date,document_revision_label,source_version,raw_response_id,content_hash,parser_version,retrieved_at,created_by,supersedes_snapshot_id,document_number,metadata)
 values(p->>'source_key',r.family,p->>'citation',p->>'title',r.api_url,p->>'canonical_url',nullif(p->>'issue_date','')::date,nullif(p->>'document_revision_date','')::date,nullif(p->>'document_revision_label',''),p->>'source_version',r.id,r.content_hash,revision,r.retrieved_at,j.requested_by,prior.id,p->>'document_number',coalesce(p->'metadata','{}')) returning * into s;
 insert into public.regulatory_snapshot_observations values(s.id,r.id,r.retrieved_at);
 if exists(select 1 from public.regulatory_snapshots x where x.id<>s.id and x.source_key=s.source_key and x.source_version=s.source_version and x.content_hash<>s.content_hash) then insert into public.regulatory_alerts(snapshot_id,job_id,code,severity,message) values(s.id,jid,'SAME_ISSUE_HASH_MISMATCH','critical','Raw body changed without a document revision/version change. Independent comparison is required.');end if;
 if prior.id is not null and prior.issue_date is distinct from s.issue_date then insert into public.regulatory_alerts(snapshot_id,job_id,code,severity,message) values(s.id,jid,'ISSUE_DATE_CHANGED','info','A new official issue date was discovered; active law and rules are unchanged until approval.');end if;
 perform public.app_write_audit(null,'regulatory.snapshot_fetched','regulatory_snapshot',s.id::text,'Immutable official response registered',jsonb_build_object('raw_hash',s.content_hash,'issue_date',s.issue_date,'document_revision_date',s.document_revision_date));return to_jsonb(s);end
$$;

create function public.vexim_stage_fda_guidance(jid uuid,worker_id text,snapshot_id uuid,section_data jsonb,chunk_data jsonb,validation jsonb) returns void language plpgsql security definer set search_path=public,extensions,pg_temp as $$
 declare j public.regulatory_ingestion_jobs;s public.regulatory_snapshots;source_row public.regulatory_sources;x jsonb;c jsonb;section_row public.regulatory_snapshot_sections;source_text text;sequence_no integer;page_total integer;expected_parser text;expected_key text;expected_format text;expected_url text;topic_value text;
 begin
 j:=public.app_regulatory_lease(jid,worker_id);
 select * into s from public.regulatory_snapshots where id=snapshot_id for update;
 if not found or s.source_family<>'fda_guidance' or s.status not in ('FETCHED','PARSE_FAILED') then raise exception 'Fetched FDA Guidance snapshot required';end if;
 if j.kind='fda_label_claims_html' then
   expected_key:='fda-label-claims';expected_format:='HTML';expected_parser:='vexim-fda-html/1.0.0';expected_url:='https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/label-claims-conventional-foods-and-dietary-supplements';
 elsif j.kind='fda_food_label_guide_pdf' then
   expected_key:='fda-food-label-guide';expected_format:='PDF';expected_parser:='vexim-fda-pdf/1.0.0';expected_url:='https://www.fda.gov/files/food/published/Food-Labeling-Guide-%28PDF%29.pdf';
 else raise exception 'FDA guidance job kind required';end if;
 if s.source_key is distinct from expected_key or s.canonical_url is distinct from expected_url or s.api_url is distinct from expected_url or s.parser_version is distinct from expected_parser or s.metadata->>'format' is distinct from expected_format or s.issue_date is not null then raise exception 'FDA snapshot/job provenance mismatch';end if;
 if section_data is null or chunk_data is null or validation is null or jsonb_typeof(section_data) is distinct from 'array' or jsonb_typeof(chunk_data) is distinct from 'array' or jsonb_typeof(validation) is distinct from 'object' or jsonb_array_length(section_data)<1 or jsonb_array_length(section_data)>512 or jsonb_array_length(chunk_data)<1 or jsonb_array_length(chunk_data)>20000 or validation->>'parser_version' is distinct from s.parser_version or validation->>'citations_valid' is distinct from 'true' or jsonb_typeof(validation->'coverage_complete') is distinct from 'boolean' or (validation->>'chunk_count')::integer is distinct from jsonb_array_length(chunk_data) or (validation->>'section_count')::integer is distinct from jsonb_array_length(section_data) then raise exception 'FDA parser output counts/citations are incomplete';end if;
 select * into source_row from public.regulatory_sources where source_key=expected_key for update;
 if not found or source_row.authority<>'FDA' or source_row.agency<>'FDA' or source_row.document_type<>'guidance' or source_row.status<>'DRAFT' or source_row.approved_by is not null or source_row.canonical_url is distinct from expected_url then raise exception 'FDA source must remain an unapproved DRAFT';end if;
 if expected_format='PDF' then
   page_total:=nullif(validation->>'page_count','')::integer;
   if page_total is null or page_total<1 or page_total>256 or jsonb_array_length(section_data)<>page_total or (validation->>'processed_page_count')::integer is distinct from page_total or coalesce((validation->>'text_page_count')::integer,0)<1 or (validation->>'text_page_count')::integer>page_total then raise exception 'PDF page coverage metadata mismatch';end if;
   for sequence_no in 1..page_total loop
     if not exists(select 1 from jsonb_array_elements(section_data) item where item->>'section'='page:'||sequence_no::text) then raise exception 'PDF page section missing';end if;
   end loop;
 elsif coalesce((validation->>'heading_count')::integer,0)<1 then raise exception 'HTML heading coverage required';end if;
 for x in select value from jsonb_array_elements(section_data) loop
   if length(trim(coalesce(x->>'heading','')))=0 or length(coalesce(x->>'content',''))>1000000 or coalesce(x->>'reserved','false') not in ('false','null') then raise exception 'Invalid FDA parsed section';end if;
   if expected_format='PDF' then
     if x->>'section' !~ '^page:[1-9][0-9]{0,2}$' then raise exception 'Invalid PDF page section';end if;
   else
     if x->>'section' !~ '^heading:[a-z0-9-]{1,80}$' or length(coalesce(x->>'content',''))=0 then raise exception 'Invalid FDA HTML heading section';end if;
   end if;
   insert into public.regulatory_snapshot_sections(snapshot_id,source_id,section,heading,content,content_hash,topic,reserved)
   values(s.id,source_row.id,x->>'section',left(x->>'heading',300),x->>'content',encode(extensions.digest(convert_to(x->>'content','UTF8'),'sha256'),'hex'),left(coalesce(x->>'topic',source_row.topic),80),false);
 end loop;
 for c in select value from jsonb_array_elements(chunk_data) loop
   select * into section_row from public.regulatory_snapshot_sections where regulatory_snapshot_sections.snapshot_id=s.id and section=c->>'section';
   if not found or length(trim(coalesce(c->>'content','')))=0 or length(coalesce(c->>'content',''))>20000 or length(trim(coalesce(c->>'heading','')))=0 or c->>'topic' is null or c->>'chunk_key' is null or (c->>'sequence') !~ '^[0-9]{1,6}$' then raise exception 'Invalid FDA chunk';end if;
   if expected_format='HTML' then
     if c->>'citation_precision' is distinct from 'heading' or c->>'citation' is distinct from source_row.citation||' — '||(c->>'heading') or c->>'source_anchor' not like s.canonical_url||'#%' or c->>'section' !~ '^heading:[a-z0-9-]{1,80}$' then raise exception 'Unresolved FDA heading citation';end if;
   else
     if c->>'citation_precision' is distinct from 'page' or c->>'section' !~ '^page:[1-9][0-9]{0,2}$' or c->>'citation' is distinct from source_row.citation||', PDF page '||substring(c->>'section' from 6) or c->>'source_anchor' is distinct from s.canonical_url||'#page='||substring(c->>'section' from 6) then raise exception 'Unresolved FDA PDF page citation';end if;
   end if;
   if jsonb_typeof(c->'topics') is distinct from 'array' or jsonb_typeof(c->'hierarchy') is distinct from 'array' or jsonb_typeof(c->'paragraph_path') is distinct from 'array' then raise exception 'FDA chunk provenance arrays required';end if;
   insert into public.regulatory_chunks(source_id,source_version,citation,heading,content,topic,obligation_type,snapshot_id,chunk_key,source_issue_date,source_content_hash,chunk_content_hash,parser_version,paragraph_path,citation_precision,sequence,source_anchor,topics,hierarchy,xml_tag,cross_references)
   values(source_row.id,source_row.version+1,c->>'citation',left(c->>'heading',300),c->>'content',left(c->>'topic',80),'guidance',s.id,s.id::text||':'||(c->>'chunk_key'),null,s.content_hash,encode(extensions.digest(convert_to(c->>'content','UTF8'),'sha256'),'hex'),s.parser_version,array(select jsonb_array_elements_text(c->'paragraph_path')),c->>'citation_precision',(c->>'sequence')::integer,c->>'source_anchor',array(select jsonb_array_elements_text(c->'topics')),c->'hierarchy',null,array[]::text[]);
 end loop;
 select string_agg(item.value->>'content',E'\n' order by item.ordinality) into source_text from jsonb_array_elements(section_data) with ordinality as item(value,ordinality);
 update public.regulatory_sources set api_url=s.api_url,issue_date=null,document_revision_date=s.document_revision_date,document_revision_label=s.document_revision_label,retrieved_at=s.retrieved_at,raw_snapshot_id=s.id,raw_content_hash=s.content_hash,parser_version=s.parser_version,ingestion_status='DRAFT',effective_from=null,effective_to=null,effective_date_unknown=true,content_hash=encode(extensions.digest(convert_to(coalesce(source_text,''),'UTF8'),'sha256'),'hex'),content_excerpt=left(coalesce(source_text,''),4000),approved_by=null,approved_at=null,updated_at=now() where id=source_row.id and status='DRAFT';
 update public.regulatory_snapshots set status='DRAFT',parser_version=validation->>'parser_version',validation_results=validation,chunk_count=jsonb_array_length(chunk_data) where id=s.id;
 perform public.app_write_audit(null,'regulatory.fda_guidance_staged','regulatory_snapshot',s.id::text,'FDA Guidance HTML/PDF persisted as DRAFT; no activation or RAG visibility',jsonb_build_object('source_key',expected_key,'format',expected_format,'raw_hash',s.content_hash,'parser_version',s.parser_version,'chunks',jsonb_array_length(chunk_data),'coverage_complete',validation->>'coverage_complete'));
end
$$;

create or replace function public.vexim_approve_source(sid uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
 declare s public.regulatory_sources;
 begin perform public.app_require_staff('regulatory_admin'); select * into s from public.regulatory_sources where id=sid for update;
 if not found or s.status<>'DRAFT' or s.created_by=auth.uid() or s.created_by is null or s.retrieved_at is null or s.content_hash is null or length(s.content_excerpt)<80 then raise exception 'Independent approver and valid snapshot required'; end if;
 if s.source_key in ('fda-label-claims','fda-food-label-guide') or (s.authority='FDA' and s.document_type='guidance') then raise exception 'Ingested FDA Guidance remains DRAFT until its dedicated expert-review and approval workflow is implemented';end if;
 if (s.effective_to is not null and s.effective_to<current_date) or (s.effective_from is not null and s.effective_from>current_date) then raise exception 'Source not currently effective'; end if;
 update public.regulatory_sources set status='CURRENT',approved_by=auth.uid(),approved_at=now(),updated_at=now() where id=sid;
 update public.regulatory_chunks set review_status='APPROVED',approved_by=auth.uid(),approved_at=now() where source_id=sid and source_version=s.version;
 perform public.app_write_audit(null,'source.approved','source',sid::text,'Approved '||s.citation||' v'||s.version,jsonb_build_object('content_hash',s.content_hash)); end
$$;

-- FDA Guidance has no promotion path until its dedicated expert-review workflow exists.
create or replace function public.vexim_match_regulatory_chunks(query_embedding extensions.vector(768),topic_filter text,category_filter text,match_count integer default 5) returns table(id uuid,citation text,content text,source_id uuid,source_version integer,content_hash text,similarity float) language sql stable security invoker set search_path=public,extensions,pg_temp as $$
 select c.id,c.citation,left(c.content,6000),s.id,s.version,s.content_hash,1-(c.embedding<=>query_embedding) from public.regulatory_chunks c join public.regulatory_sources s on s.id=c.source_id
 where public.app_staff() is not null and public.app_source_current(s) and c.source_version=s.version and c.review_status='APPROVED' and c.citation_precision<>'unresolved' and ((s.raw_snapshot_id is null and c.snapshot_id is null) or (c.snapshot_id=s.raw_snapshot_id and exists(select 1 from public.regulatory_snapshots x where x.id=s.raw_snapshot_id and x.status='ACTIVE' and x.content_hash=s.raw_content_hash))) and c.jurisdiction='US' and c.language='en' and c.topic=topic_filter and c.applies_to ? category_filter and c.embedding is not null and (c.effective_from is null or c.effective_from<=current_date) and (c.effective_to is null or c.effective_to>=current_date)
 order by c.embedding<=>query_embedding limit least(greatest(match_count,1),4)
$$;

revoke all on function public.vexim_stage_fda_guidance(uuid,text,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.vexim_stage_fda_guidance(uuid,text,uuid,jsonb,jsonb,jsonb) to service_role;
revoke all on function public.vexim_regulatory_rate_limit(text),public.vexim_record_regulatory_snapshot(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.vexim_regulatory_rate_limit(text),public.vexim_record_regulatory_snapshot(uuid,text,jsonb) to service_role;

commit;
