-- Vexim Label Review / Supabase PostgreSQL
-- Run as project owner, in order. All customer writes use narrowly-scoped RPCs.
-- No client service-role key. No user-supplied staff roles. No public buckets.
begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;

create type public.staff_role as enum ('reviewer','regulatory_admin','system_admin');
create type public.member_role as enum ('customer_admin','customer_contributor');
create type public.review_status as enum ('DRAFT','INTAKE_PENDING','INPUT_VALIDATION','PROCESSING','AI_REVIEW_READY','HUMAN_REVIEW','WAITING_FOR_CUSTOMER','REVISION_REQUIRED','APPROVED_WITH_NOTES','COMPLETED','ARCHIVED','PROCESSING_FAILED','SOURCE_UNAVAILABLE','MODEL_FAILED','MANUAL_ESCALATION_REQUIRED');
create type public.finding_severity as enum ('critical','major','minor','information');
create type public.finding_status as enum ('open','accepted','dismissed');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '', email text not null,
  staff_role public.staff_role, active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.organizations (
  id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 2 and 300),
  country text not null default 'VN', contact_email text not null check(contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  contact_name text not null default '', status text not null default 'active' check(status in ('active','inactive')),
  created_at timestamptz not null default now()
);
create table public.organization_members (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  user_id uuid not null references public.profiles(id), role public.member_role not null,
  status text not null default 'active' check(status in ('active','invited','locked')), created_at timestamptz not null default now(),
  unique(organization_id,user_id)
);
create index organization_members_user on public.organization_members(user_id,organization_id);
create table public.products (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  name text not null check(length(name) between 2 and 300), brand text not null default '' check(length(brand)<=150),
  category text not null check(category in ('dry_packaged_tea','tea_bag','dietary_supplement','ready_to_drink','other')),
  form text not null check(form in ('loose_leaf','tea_bag','powder','liquid','other')), market text not null default 'US' check(market='US'),
  channel text[] not null default '{}', expected_us_units_12m integer check(expected_us_units_12m>=0), employee_fte numeric check(employee_fte>=0),
  classification_status text not null default 'uncertain' check(classification_status in ('conventional_food','uncertain','out_of_scope')),
  package_size text not null default '', net_quantity text not null default '',
  manufacturer jsonb not null default '{"name":"","address":""}', packer jsonb not null default '{"name":"","address":""}',
  distributor jsonb not null default '{"name":"","address":""}', importer jsonb not null default '{"name":"","address":""}',
  claims text[] not null default '{}', certifications text[] not null default '{}', exemption_requested boolean not null default false,
  formula_confirmed boolean not null default false, claims_confirmed boolean not null default false,
  assigned_to uuid references public.profiles(id), created_by uuid not null references public.profiles(id),
  color text not null default 'sage', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id,organization_id), check(cardinality(claims)<=100), check(cardinality(certifications)<=100)
);
create index products_org on public.products(organization_id,updated_at desc);
create table public.formula_ingredients (
  id uuid primary key default gen_random_uuid(), product_id uuid not null, organization_id uuid not null,
  name_original text not null, name_english text not null, normalized_name text not null default '',
  percentage numeric check(percentage between 0 and 100), "order" integer not null check("order">0),
  allergen_groups text[] not null default '{}', source text not null default 'customer_input' check(source='customer_input'),
  foreign key(product_id,organization_id) references public.products(id,organization_id), unique(product_id,"order")
);
create table public.label_versions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, product_id uuid not null, version integer not null check(version>0),
  status text not null default 'uploaded' check(status in ('uploaded','processing','under_review','reviewed','rejected')),
  uploaded_by uuid not null references public.profiles(id), uploaded_at timestamptz not null default now(),
  foreign key(product_id,organization_id) references public.products(id,organization_id),
  unique(product_id,version), unique(id,organization_id,product_id), unique(id,organization_id)
);
create table public.label_files (
  id uuid primary key default gen_random_uuid(), label_version_id uuid not null, organization_id uuid not null,
  name text not null, mime_type text not null check(mime_type in ('application/pdf','image/png','image/jpeg','image/tiff')),
  size bigint not null check(size>0 and size<=52428800), storage_path text not null unique,
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'), page_count integer not null default 1 check(page_count between 1 and 10),
  scan_status text not null default 'pending' check(scan_status in ('pending','clean','rejected','dev_unscanned')),
  kind text not null check(kind in ('original','normalized')), original_file_id uuid references public.label_files(id), page integer check(page between 1 and 10),
  created_at timestamptz not null default now(),
  foreign key(label_version_id,organization_id) references public.label_versions(id,organization_id)
);
create index label_files_version on public.label_files(label_version_id,kind);
create unique index one_normalized_page on public.label_files(original_file_id,page) where kind='normalized';
create table public.reviews (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, product_id uuid not null, label_version_id uuid not null,
  review_scope text not null default 'us_federal_food_labeling_mvp' check(review_scope='us_federal_food_labeling_mvp'),
  status public.review_status not null default 'PROCESSING', progress integer not null default 0 check(progress between 0 and 100),
  assigned_to uuid references public.profiles(id), requested_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), due_at timestamptz not null default (now()+interval '2 days'),
  pipeline jsonb not null default '[]', error_message text, idempotency_key text not null check(length(idempotency_key) between 1 and 200),
  dossier_snapshot jsonb not null, rule_snapshot jsonb not null default '[]', missing_information text[] not null default '{}',
  approved_by uuid references public.profiles(id), approved_at timestamptz, approval_comment text,
  foreign key(label_version_id,organization_id,product_id) references public.label_versions(id,organization_id,product_id),
  unique(id,organization_id), unique(organization_id,idempotency_key), unique(label_version_id,review_scope)
);
create index reviews_org_status on public.reviews(organization_id,status,updated_at desc);
create table public.extracted_fields (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, label_version_id uuid not null,
  field text not null, value text, normalized jsonb, confidence numeric not null check(confidence between 0 and 1),
  evidence jsonb not null, extraction_model text not null, extracted_at timestamptz not null default now(), manually_verified boolean not null default false,
  foreign key(label_version_id,organization_id) references public.label_versions(id,organization_id)
);
create table public.regulatory_sources (
  id uuid primary key default gen_random_uuid(), source_key text not null unique, authority text not null,
  agency text not null, document_type text not null, citation text not null, title text not null,
  canonical_url text not null check(canonical_url ~ '^https://(www\.(ecfr\.gov|fda\.gov|govinfo\.gov|ams\.usda\.gov|cbp\.gov|federalregister\.gov)|uscode\.house\.gov)/'),
  topic text not null, jurisdiction text not null default 'US', language text not null default 'en',
  retrieved_at timestamptz, effective_from date, effective_to date,
  status text not null default 'DRAFT' check(status in ('DRAFT','CURRENT','SUPERSEDED','UNAVAILABLE')), priority integer not null check(priority between 1 and 6),
  content_hash text check(content_hash ~ '^[a-f0-9]{64}$'), content_excerpt text not null default '', version integer not null default 1,
  created_by uuid references public.profiles(id), approved_by uuid references public.profiles(id), approved_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(effective_to is null or effective_from is null or effective_to>=effective_from),
  check(status<>'CURRENT' or (content_hash is not null and retrieved_at is not null and approved_by is not null and approved_at is not null))
);
create table public.regulatory_source_versions (
  id uuid primary key default gen_random_uuid(), source_id uuid not null references public.regulatory_sources(id), version integer not null,
  snapshot jsonb not null, archived_at timestamptz not null default now(), unique(source_id,version)
);
create table public.regulatory_chunks (
  id uuid primary key default gen_random_uuid(), source_id uuid not null references public.regulatory_sources(id), source_version integer not null,
  citation text not null, heading text, content text not null, topic text not null, obligation_type text not null default 'guidance',
  applies_to jsonb not null default '["dry_packaged_tea","tea_bag"]', jurisdiction text not null default 'US', language text not null default 'en',
  effective_from date, effective_to date, embedding extensions.vector(768),
  review_status text not null default 'DRAFT' check(review_status in ('DRAFT','APPROVED','SUPERSEDED')),
  approved_by uuid references public.profiles(id), approved_at timestamptz, created_at timestamptz not null default now()
);
create index regulatory_chunks_source on public.regulatory_chunks(source_id,source_version);
create table public.compliance_rules (
  id uuid primary key default gen_random_uuid(), rule_key text not null, name text not null, version integer not null check(version>0),
  scope text[] not null default '{dry_packaged_tea,tea_bag}', condition_json jsonb not null, action_json jsonb not null,
  source_citations uuid[] not null default '{}', source_snapshot jsonb not null default '[]',
  status text not null default 'DRAFT' check(status in ('DRAFT','ACTIVE','SUPERSEDED')), effective_from date, effective_to date,
  created_by uuid references public.profiles(id), approved_by uuid references public.profiles(id),
  test_status text not null default 'pending' check(test_status in ('pending','passed','failed')), definition_hash text not null default '', test_hash text, test_source_snapshot jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(rule_key,version),
  check(cardinality(source_citations)>0), check(effective_to is null or effective_from is null or effective_to>=effective_from),
  check(status<>'ACTIVE' or (approved_by is not null and test_status='passed' and test_hash=definition_hash))
);
create unique index one_active_rule on public.compliance_rules(rule_key) where status='ACTIVE';
create table public.rule_test_runs (
  id uuid primary key default gen_random_uuid(), rule_id uuid not null references public.compliance_rules(id),
  definition_hash text not null, results jsonb not null, tested_by uuid references public.profiles(id), created_at timestamptz not null default now()
);
create table public.findings (
  id uuid primary key default gen_random_uuid(), review_id uuid not null, organization_id uuid not null,
  rule_key text not null, rule_version integer not null, severity public.finding_severity not null, status public.finding_status not null default 'open',
  title text not null, description text not null, evidence jsonb not null check(jsonb_array_length(evidence)>0),
  citation_ids uuid[] not null default '{}', citation_pending boolean not null default true, suggested_action text not null,
  ai_confidence numeric check(ai_confidence between 0 and 1), reasoning_category text not null, human_review_required boolean not null default true,
  reviewer_comment text, reviewed_by uuid references public.profiles(id), reviewed_at timestamptz, created_at timestamptz not null default now(),
  foreign key(review_id,organization_id) references public.reviews(id,organization_id),
  check(status='open' or (length(trim(reviewer_comment))>=5 and reviewed_by is not null and reviewed_at is not null))
);
create index findings_review on public.findings(review_id,severity,status);
create table public.customer_requests (
  id uuid primary key default gen_random_uuid(), review_id uuid not null, organization_id uuid not null,
  message text not null check(length(message)>=10), requested_documents text[] not null default '{}', status text not null default 'open' check(status in ('open','resolved')),
  created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
  foreign key(review_id,organization_id) references public.reviews(id,organization_id)
);
create sequence public.report_number_seq;
create table public.reports (
  id uuid primary key default gen_random_uuid(), review_id uuid not null unique, organization_id uuid not null,
  product_id uuid not null, label_version_id uuid not null,
  report_number text not null unique default ('VLR-'||extract(year from now())::text||'-'||lpad(nextval('public.report_number_seq')::text,4,'0')),
  snapshot jsonb not null, status text not null default 'pending' check(status in ('pending','generated','failed')),
  pdf_path text, json_path text, created_at timestamptz not null default now(),
  foreign key(review_id,organization_id) references public.reviews(id,organization_id),
  foreign key(label_version_id,organization_id,product_id) references public.label_versions(id,organization_id,product_id)
);
create table public.pipeline_jobs (
  id uuid primary key default gen_random_uuid(), review_id uuid not null unique, organization_id uuid not null,
  status text not null default 'queued' check(status in ('queued','running','retry','completed','dead_letter')),
  from_stage text not null default 'validation' check(from_stage in ('validation','ocr','extraction','rules','verification')),
  current_stage text not null default 'validation', attempts integer not null default 0 check(attempts between 0 and 3),
  next_run_at timestamptz not null default now(), locked_by text, locked_until timestamptz, last_error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(review_id,organization_id) references public.reviews(id,organization_id)
);
create index pipeline_jobs_queue on public.pipeline_jobs(status,next_run_at);
create table public.pipeline_outputs (
  id uuid primary key default gen_random_uuid(), job_id uuid not null references public.pipeline_jobs(id), review_id uuid not null,
  organization_id uuid not null, stage text not null, payload jsonb not null, created_at timestamptz not null default now(),
  foreign key(review_id,organization_id) references public.reviews(id,organization_id), unique(job_id,stage)
);
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations(id), actor_id uuid,
  actor_name text not null, action text not null, entity_type text not null, entity_id text not null, description text not null,
  metadata jsonb not null default '{}', created_at timestamptz not null default now()
);
create index audit_logs_org on public.audit_logs(organization_id,created_at desc);

-- Identity helpers are SECURITY DEFINER to avoid RLS recursion.
create function public.app_staff() returns public.staff_role language sql stable security definer set search_path=public,pg_temp as $$
 select staff_role from public.profiles where id=auth.uid() and active
$$;
create function public.app_is_active() returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.profiles where id=auth.uid() and active)
$$;
create function public.app_can_read_org(org uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select public.app_is_active() and (coalesce(public.app_staff() in ('reviewer','system_admin'),false) or exists(select 1 from public.organization_members m join public.organizations o on o.id=m.organization_id where m.user_id=auth.uid() and m.organization_id=org and m.status='active' and o.status='active'))
$$;
create function public.app_can_edit_org(org uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$ select public.app_can_read_org(org) $$;
create function public.app_can_admin_org(org uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select public.app_is_active() and (coalesce(public.app_staff()='system_admin',false) or exists(select 1 from public.organization_members m join public.organizations o on o.id=m.organization_id where m.user_id=auth.uid() and m.organization_id=org and m.role='customer_admin' and m.status='active' and o.status='active'))
$$;
create function public.app_require_staff(required public.staff_role) returns void language plpgsql security definer set search_path=public,pg_temp as $$
 begin if not public.app_is_active() or public.app_staff() is distinct from required then raise exception 'Insufficient role' using errcode='42501'; end if; end
$$;
create function public.app_require_service() returns void language plpgsql security definer set search_path=public,pg_temp as $$
 begin if coalesce(auth.role(),'')<>'service_role' then raise exception 'Worker/server only' using errcode='42501'; end if; end
$$;
create function public.app_source_current(s public.regulatory_sources) returns boolean language sql stable as $$
 select s.status='CURRENT' and s.content_hash is not null and s.approved_by is not null and (s.effective_from is null or s.effective_from<=current_date) and (s.effective_to is null or s.effective_to>=current_date)
$$;
create function public.app_source_refs(ids uuid[]) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'version',s.version,'content_hash',s.content_hash) order by s.id),'[]') from public.regulatory_sources s where s.id=any(ids)
$$;
create function public.app_product_json(pid uuid) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select to_jsonb(p)||jsonb_build_object('formula',coalesce((select jsonb_agg(to_jsonb(i)-'product_id'-'organization_id' order by i."order") from public.formula_ingredients i where i.product_id=p.id),'[]')) from public.products p where p.id=pid
$$;
create function public.app_label_json(lid uuid) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select to_jsonb(l)||jsonb_build_object('original_files',coalesce((select jsonb_agg(to_jsonb(f)-'label_version_id'-'organization_id' order by f.created_at,f.name) from public.label_files f where f.label_version_id=l.id and f.kind='original'),'[]'),'normalized_files',coalesce((select jsonb_agg(to_jsonb(f)-'label_version_id'-'organization_id' order by f.original_file_id,f.page) from public.label_files f where f.label_version_id=l.id and f.kind='normalized'),'[]'),'extracted_fields',coalesce((select jsonb_agg(to_jsonb(e)-'label_version_id'-'organization_id' order by e.extracted_at,e.field) from public.extracted_fields e where e.label_version_id=l.id),'[]')) from public.label_versions l where l.id=lid
$$;

create function public.app_write_audit(p_org uuid,p_action text,p_type text,p_id text,p_description text,p_metadata jsonb default '{}') returns void language plpgsql security definer set search_path=public,pg_temp as $$
 declare who text;
 begin select full_name into who from public.profiles where id=auth.uid();
 insert into public.audit_logs(organization_id,actor_id,actor_name,action,entity_type,entity_id,description,metadata) values(p_org,auth.uid(),coalesce(nullif(who,''),'Pipeline / system'),p_action,p_type,p_id,left(p_description,3000),p_metadata);
 end
$$;
create function public.app_audit_trigger() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
 declare rowdata jsonb; beforedata jsonb; org uuid; action text;
 begin rowdata:=case when TG_OP='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 beforedata:=case when TG_OP<>'INSERT' then to_jsonb(old) else null end;
 org:=case when TG_TABLE_NAME='organizations' then (rowdata->>'id')::uuid else nullif(rowdata->>'organization_id','')::uuid end;
 action:=case TG_OP when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end;
 if TG_TABLE_NAME='regulatory_sources' then rowdata:=rowdata-'content_excerpt'; beforedata:=beforedata-'content_excerpt'; end if;
 if TG_TABLE_NAME='reports' then
 rowdata:=(rowdata-'snapshot')||jsonb_build_object('result',rowdata->'snapshot'->>'result','snapshot_sha256',encode(extensions.digest(convert_to((rowdata->'snapshot')::text,'UTF8'),'sha256'),'hex'));
 if beforedata is not null then beforedata:=(beforedata-'snapshot')||jsonb_build_object('snapshot_sha256',encode(extensions.digest(convert_to((beforedata->'snapshot')::text,'UTF8'),'sha256'),'hex')); end if;
 end if;
 perform public.app_write_audit(org,TG_ARGV[0]||'.'||action,TG_ARGV[0],rowdata->>'id',TG_ARGV[0]||' '||action||coalesce(' · '||(rowdata->>'name'),'')||coalesce(' · '||(rowdata->>'title'),''),jsonb_build_object('before',beforedata,'after',case when TG_OP<>'DELETE' then rowdata else null end));
 return case when TG_OP='DELETE' then old else new end;
 end
$$;
do $$ declare t text; begin foreach t in array array['products','formula_ingredients','label_versions','label_files','reviews','findings','customer_requests','regulatory_sources','compliance_rules','reports','organization_members','organizations','extracted_fields'] loop
 execute format('create trigger audit_%I after insert or update or delete on public.%I for each row execute function public.app_audit_trigger(%L)',t,t,case t when 'products' then 'product' when 'formula_ingredients' then 'formula' when 'label_versions' then 'label' when 'label_files' then 'file' when 'reviews' then 'review' when 'findings' then 'finding' when 'customer_requests' then 'information' when 'regulatory_sources' then 'source' when 'compliance_rules' then 'rule' when 'reports' then 'report' when 'organization_members' then 'member' when 'organizations' then 'organization' else 'extraction' end);
 end loop; end $$;
-- Permission changes are audited without globally leaking customer profile PII.
create function public.app_profile_audit() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
 declare org uuid; info jsonb;
 begin
 if old.staff_role is distinct from new.staff_role or old.active is distinct from new.active then
 info:=jsonb_build_object('target_id',new.id,'before_role',old.staff_role,'after_role',new.staff_role,'before_active',old.active,'after_active',new.active);
 for org in select distinct organization_id from public.organization_members where user_id=new.id loop
 perform public.app_write_audit(org,'member.account_changed','member',new.id::text,'Account access changed',info);
 end loop;
 if old.staff_role is not null or new.staff_role is not null then perform public.app_write_audit(null,'user.staff_role_changed','user',new.id::text,'Trusted staff provisioning changed',info); end if;
 end if; return new;
 end
$$;
create trigger profile_permissions_audit after update on public.profiles for each row execute function public.app_profile_audit();

create function public.app_immutable_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$
 begin
 if TG_TABLE_NAME='audit_logs' then
   raise exception 'Audit trail is append-only';
 elsif TG_TABLE_NAME='reports' then
   if TG_OP='DELETE' then raise exception 'Report snapshot is immutable'; end if;
   if old.snapshot is distinct from new.snapshot or old.review_id is distinct from new.review_id or old.report_number is distinct from new.report_number then raise exception 'Report snapshot is immutable'; end if;
 elsif TG_TABLE_NAME='label_files' then
   if old.kind='original' then
     if TG_OP='DELETE' then raise exception 'Original label manifest is immutable'; end if;
     if old.storage_path is distinct from new.storage_path or old.sha256 is distinct from new.sha256 or old.size is distinct from new.size or old.name is distinct from new.name or old.mime_type is distinct from new.mime_type or old.label_version_id is distinct from new.label_version_id or old.organization_id is distinct from new.organization_id then raise exception 'Original label manifest is immutable'; end if;
   end if;
 elsif TG_TABLE_NAME='reviews' then
   if TG_OP='DELETE' then raise exception 'Submitted dossier and review identity are immutable'; end if;
   if old.dossier_snapshot is distinct from new.dossier_snapshot or old.label_version_id is distinct from new.label_version_id or old.organization_id is distinct from new.organization_id or old.product_id is distinct from new.product_id or old.review_scope is distinct from new.review_scope or old.idempotency_key is distinct from new.idempotency_key then raise exception 'Submitted dossier and review identity are immutable'; end if;
 elsif TG_TABLE_NAME='label_versions' then
   if TG_OP='DELETE' then raise exception 'Label version identity is immutable'; end if;
   if old.version is distinct from new.version or old.product_id is distinct from new.product_id or old.organization_id is distinct from new.organization_id or old.uploaded_by is distinct from new.uploaded_by or old.uploaded_at is distinct from new.uploaded_at then raise exception 'Label version identity is immutable'; end if;
 elsif TG_TABLE_NAME='regulatory_source_versions' then
   raise exception 'Archived source snapshot is immutable';
 elsif TG_TABLE_NAME='compliance_rules' then
   if old.status in ('ACTIVE','SUPERSEDED') then
     if TG_OP='DELETE' then raise exception 'Published rule definition is immutable; create a new version'; end if;
     if old.rule_key is distinct from new.rule_key or old.version is distinct from new.version or old.scope is distinct from new.scope or old.condition_json is distinct from new.condition_json or old.action_json is distinct from new.action_json or old.source_citations is distinct from new.source_citations or old.name is distinct from new.name or old.created_by is distinct from new.created_by or old.effective_from is distinct from new.effective_from or old.effective_to is distinct from new.effective_to then raise exception 'Published rule definition is immutable; create a new version'; end if;
   end if;
 end if;
 return case when TG_OP='DELETE' then old else new end;
 end
$$;
create trigger submitted_dossier_immutable before update or delete on public.reviews for each row execute function public.app_immutable_guard();
create trigger label_identity_immutable before update or delete on public.label_versions for each row execute function public.app_immutable_guard();
create trigger audit_no_tamper before update or delete on public.audit_logs for each row execute function public.app_immutable_guard();
create trigger report_snapshot_immutable before update or delete on public.reports for each row execute function public.app_immutable_guard();
create trigger original_manifest_immutable before update or delete on public.label_files for each row execute function public.app_immutable_guard();
create trigger source_version_immutable before update or delete on public.regulatory_source_versions for each row execute function public.app_immutable_guard();
create trigger rule_definition_immutable before update or delete on public.compliance_rules for each row execute function public.app_immutable_guard();
create function public.app_rule_hash() returns trigger language plpgsql set search_path=public,extensions,pg_temp as $$
 begin new.definition_hash:=encode(extensions.digest(convert_to(jsonb_build_object('rule_key',new.rule_key,'name',new.name,'scope',new.scope,'condition_json',new.condition_json,'action_json',new.action_json,'source_citations',new.source_citations,'effective_from',new.effective_from,'effective_to',new.effective_to)::text,'UTF8'),'sha256'),'hex'); return new; end
$$;
create trigger rule_hash before insert or update on public.compliance_rules for each row execute function public.app_rule_hash();
create function public.app_new_user() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
 begin insert into public.profiles(id,full_name,email) values(new.id,left(coalesce(new.raw_user_meta_data->>'full_name',''),300),coalesce(new.email,'')); return new; end
$$;
create trigger vexim_auth_user_created after insert on auth.users for each row execute function public.app_new_user();
insert into public.profiles(id,full_name,email) select id,left(coalesce(raw_user_meta_data->>'full_name',''),300),coalesce(email,'') from auth.users on conflict(id) do nothing;

-- Row-level reads. No authenticated INSERT/UPDATE/DELETE policies on business tables.
alter table public.profiles enable row level security;
create policy profile_read on public.profiles for select to authenticated using (id=auth.uid() or coalesce(public.app_staff() in ('reviewer','system_admin'),false) or exists(select 1 from public.organization_members m where m.user_id=profiles.id and public.app_can_read_org(m.organization_id)));
alter table public.organizations enable row level security;
create policy org_read on public.organizations for select to authenticated using(public.app_can_read_org(id));
alter table public.organization_members enable row level security;
create policy members_read on public.organization_members for select to authenticated using(public.app_can_read_org(organization_id));
do $$ declare t text; begin foreach t in array array['products','formula_ingredients','label_versions','label_files','reviews','extracted_fields','findings','customer_requests','reports','pipeline_jobs','pipeline_outputs'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy tenant_read on public.%I for select to authenticated using(public.app_can_read_org(organization_id))',t);
 end loop; end $$;
do $$ declare t text; begin foreach t in array array['regulatory_sources','regulatory_source_versions','regulatory_chunks','compliance_rules','rule_test_runs'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy staff_read on public.%I for select to authenticated using(public.app_staff() is not null)',t);
 end loop; end $$;
alter table public.audit_logs enable row level security;
create policy audit_read on public.audit_logs for select to authenticated using ((organization_id is null and public.app_staff() is not null) or (public.app_can_read_org(organization_id) and (public.app_staff() in ('reviewer','system_admin') or public.app_can_admin_org(organization_id))));

-- Business RPCs, enforce identity/tenant/roles in database, even if API is bypassed.
create function public.vexim_save_organization(p jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
 declare oid uuid; existing boolean;
 begin if not public.app_is_active() then raise exception 'Account unavailable' using errcode='42501'; end if;
 oid:=coalesce(nullif(p->>'id','')::uuid,gen_random_uuid()); select exists(select 1 from public.organizations where id=oid) into existing;
 if existing then
 if not public.app_can_admin_org(oid) then raise exception 'Organization admin required' using errcode='42501'; end if;
 update public.organizations set name=trim(p->>'name'),contact_name=coalesce(p->>'contact_name',''),contact_email=p->>'contact_email',country=coalesce(p->>'country','VN'),status=case when public.app_staff()='system_admin' then coalesce(p->>'status','active') else status end where id=oid;
 else
 if public.app_staff() is not null and public.app_staff()<>'system_admin' then raise exception 'System admin required to create a customer' using errcode='42501'; end if;
 if public.app_staff() is null and exists(select 1 from public.organization_members where user_id=auth.uid()) then raise exception 'A customer cannot create another tenant' using errcode='42501'; end if;
 insert into public.organizations(id,name,contact_name,contact_email,country) values(oid,trim(p->>'name'),coalesce(p->>'contact_name',''),p->>'contact_email',coalesce(p->>'country','VN'));
 if public.app_staff() is null then insert into public.organization_members(organization_id,user_id,role) values(oid,auth.uid(),'customer_admin'); end if;
 end if; return (select to_jsonb(o) from public.organizations o where id=oid); end
$$;
create function public.vexim_save_product(p jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
 declare pid uuid:=coalesce(nullif(p->>'id','')::uuid,gen_random_uuid()); org uuid:=(p->>'organization_id')::uuid; i jsonb; ordinal integer:=0;
 begin if not coalesce(public.app_can_edit_org(org),false) then raise exception 'Tenant access denied' using errcode='42501'; end if;
 if exists(select 1 from public.products where id=pid and organization_id<>org) then raise exception 'Tenant mismatch' using errcode='42501'; end if;
 if jsonb_typeof(p->'formula')<>'array' or jsonb_array_length(p->'formula')>200 then raise exception 'Invalid formula'; end if;
 insert into public.products(id,organization_id,name,brand,category,form,channel,expected_us_units_12m,employee_fte,classification_status,package_size,net_quantity,manufacturer,packer,distributor,importer,claims,certifications,exemption_requested,formula_confirmed,claims_confirmed,assigned_to,created_by)
 values(pid,org,trim(p->>'name'),coalesce(p->>'brand',''),p->>'category',p->>'form',array(select jsonb_array_elements_text(coalesce(p->'channel','[]'))),nullif(p->>'expected_us_units_12m','')::integer,nullif(p->>'employee_fte','')::numeric,case when p->>'category' in ('dry_packaged_tea','tea_bag') and p->>'form'<>'liquid' then 'conventional_food' else 'out_of_scope' end,coalesce(p->>'package_size',''),coalesce(p->>'net_quantity',''),coalesce(p->'manufacturer','{"name":"","address":""}'),coalesce(p->'packer','{"name":"","address":""}'),coalesce(p->'distributor','{"name":"","address":""}'),coalesce(p->'importer','{"name":"","address":""}'),array(select jsonb_array_elements_text(coalesce(p->'claims','[]'))),array(select jsonb_array_elements_text(coalesce(p->'certifications','[]'))),coalesce((p->>'exemption_requested')::boolean,false),coalesce((p->>'formula_confirmed')::boolean,false),coalesce((p->>'claims_confirmed')::boolean,false),case when public.app_staff()='reviewer' then auth.uid() else null end,auth.uid())
 on conflict(id) do update set name=excluded.name,brand=excluded.brand,category=excluded.category,form=excluded.form,channel=excluded.channel,expected_us_units_12m=excluded.expected_us_units_12m,employee_fte=excluded.employee_fte,classification_status=excluded.classification_status,package_size=excluded.package_size,net_quantity=excluded.net_quantity,manufacturer=excluded.manufacturer,packer=excluded.packer,distributor=excluded.distributor,importer=excluded.importer,claims=excluded.claims,certifications=excluded.certifications,exemption_requested=excluded.exemption_requested,formula_confirmed=excluded.formula_confirmed,claims_confirmed=excluded.claims_confirmed,updated_at=now();
 delete from public.formula_ingredients where product_id=pid;
 for i in select * from jsonb_array_elements(p->'formula') loop ordinal:=ordinal+1;
 insert into public.formula_ingredients(product_id,organization_id,name_original,name_english,normalized_name,percentage,"order",allergen_groups)
 values(pid,org,left(coalesce(i->>'name_original',''),300),left(coalesce(i->>'name_english',''),300),left(coalesce(i->>'normalized_name',''),300),nullif(i->>'percentage','')::numeric,ordinal,array(select jsonb_array_elements_text(coalesce(i->'allergen_groups','[]')))); end loop;
 return public.app_product_json(pid); end
$$;
create function public.vexim_create_label_version(pid uuid,manifest jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
 declare p public.products; lid uuid:=gen_random_uuid(); ver integer; item jsonb; fid uuid;
 begin select * into p from public.products where id=pid for update; if not found or not coalesce(public.app_can_edit_org(p.organization_id),false) then raise exception 'Product not accessible' using errcode='42501'; end if;
 if jsonb_typeof(manifest)<>'array' or jsonb_array_length(manifest) not between 1 and 20 then raise exception 'One to twenty label files required'; end if;
 select coalesce(max(version),0)+1 into ver from public.label_versions where product_id=pid;
 insert into public.label_versions(id,organization_id,product_id,version,uploaded_by) values(lid,p.organization_id,pid,ver,auth.uid());
 for item in select * from jsonb_array_elements(manifest) loop fid:=coalesce(nullif(item->>'id','')::uuid,gen_random_uuid());
 insert into public.label_files(id,label_version_id,organization_id,name,mime_type,size,storage_path,sha256,page_count,kind) values(fid,lid,p.organization_id,left(item->>'name',500),item->>'mime_type',(item->>'size')::bigint,p.organization_id::text||'/'||lid::text||'/original/'||fid::text,item->>'sha256',(item->>'page_count')::integer,'original');
 end loop; return public.app_label_json(lid); end
$$;
create function public.vexim_submit_review(lid uuid,idem text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
 declare l public.label_versions; p public.products; r public.reviews; dossier jsonb; steps jsonb;
 begin select * into l from public.label_versions where id=lid for update;
 if not found or not coalesce(public.app_can_edit_org(l.organization_id),false) then raise exception 'Label not accessible' using errcode='42501'; end if;
 select * into r from public.reviews where label_version_id=lid; if found then return to_jsonb(r); end if;
 select * into p from public.products where id=l.product_id;
 if not p.formula_confirmed or not p.claims_confirmed or p.brand='' or p.package_size='' or p.net_quantity='' or p.manufacturer->>'name'='' or p.manufacturer->>'address'='' or p.expected_us_units_12m is null or cardinality(p.channel)=0 or (p.exemption_requested and p.employee_fte is null) then raise exception 'Incomplete intake'; end if;
 if not exists(select 1 from public.formula_ingredients where product_id=p.id) or exists(select 1 from public.formula_ingredients where product_id=p.id and (name_original='' or name_english='')) then raise exception 'Incomplete formula'; end if;
 if (select bool_and(percentage is not null) from public.formula_ingredients where product_id=p.id) and abs((select sum(percentage) from public.formula_ingredients where product_id=p.id)-100)>0.01 then raise exception 'Formula percentages must sum to 100'; end if;
 if not exists(select 1 from public.label_files where label_version_id=lid and kind='original') or exists(select 1 from public.label_files f where f.label_version_id=lid and f.kind='original' and not exists(select 1 from storage.objects o where o.bucket_id='label-originals' and o.name=f.storage_path)) then raise exception 'Original upload incomplete'; end if;
 dossier:=public.app_product_json(p.id); steps:='[{"stage":"validation","status":"pending","attempts":0},{"stage":"ocr","status":"pending","attempts":0},{"stage":"extraction","status":"pending","attempts":0},{"stage":"rules","status":"pending","attempts":0},{"stage":"verification","status":"pending","attempts":0}]';
 insert into public.reviews(organization_id,product_id,label_version_id,assigned_to,requested_by,pipeline,idempotency_key,dossier_snapshot) values(p.organization_id,p.id,lid,p.assigned_to,auth.uid(),steps,idem,dossier) returning * into r;
 insert into public.pipeline_jobs(review_id,organization_id) values(r.id,r.organization_id); update public.label_versions set status='processing' where id=lid;
 return to_jsonb(r); end
$$;
create function public.vexim_assign_review(rid uuid,reviewer_id uuid,reason text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
 declare r public.reviews;
 begin
 if not public.app_is_active() or not coalesce(public.app_staff() in ('reviewer','system_admin'),false) then raise exception 'Reviewer or system admin required' using errcode='42501'; end if;
 if public.app_staff()='reviewer' and reviewer_id<>auth.uid() then raise exception 'Reviewer may only claim their own task' using errcode='42501'; end if;
 if not exists(select 1 from public.profiles where id=reviewer_id and staff_role='reviewer' and active) or length(trim(reason))<5 then raise exception 'Active reviewer and assignment reason required'; end if;
 select * into r from public.reviews where id=rid for update;
 if not found or r.status in ('COMPLETED','APPROVED_WITH_NOTES','ARCHIVED') then raise exception 'Review closed or unavailable'; end if;
 update public.reviews set assigned_to=reviewer_id,updated_at=now() where id=rid;
 update public.products set assigned_to=reviewer_id,updated_at=now() where id=r.product_id;
 perform public.app_write_audit(r.organization_id,'review.assigned','review',rid::text,trim(reason),jsonb_build_object('previous',r.assigned_to,'assigned_to',reviewer_id));
 end
$$;
create function public.app_editable_review(rid uuid) returns public.reviews language plpgsql security definer set search_path=public,pg_temp as $$
 declare r public.reviews;
 begin perform public.app_require_staff('reviewer'); select * into r from public.reviews where id=rid for update;
 if not found or not public.app_can_read_org(r.organization_id) then raise exception 'Review unavailable' using errcode='42501'; end if;
 if r.status in ('COMPLETED','APPROVED_WITH_NOTES','ARCHIVED','PROCESSING') then raise exception 'Review is processing or closed'; end if; return r; end
$$;
create function public.app_validate_evidence(ev jsonb,lid uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
 declare e jsonb; b jsonb; lf public.label_files;
 begin if jsonb_typeof(ev)<>'array' or jsonb_array_length(ev)=0 then raise exception 'Evidence required'; end if;
 for e in select * from jsonb_array_elements(ev) loop
 if coalesce(e->>'text','')='' then raise exception 'Empty evidence'; end if;
 if coalesce(e->>'kind','observed')<>'dossier' then
 select * into lf from public.label_files where id=nullif(e->>'file_id','')::uuid and label_version_id=lid and kind='original';
 if not found or (e->>'page')::integer not between 1 and lf.page_count then raise exception 'Evidence file/page mismatch'; end if;
 end if;
 b:=e->'bbox'; if b is not null and b<>'null'::jsonb then
 if jsonb_typeof(b)<>'array' or jsonb_array_length(b)<>4 then raise exception 'Invalid evidence bbox'; end if;
 if exists(select 1 from jsonb_array_elements_text(b) v where v::numeric<0 or v::numeric>1) or (b->>2)::numeric<=(b->>0)::numeric or (b->>3)::numeric<=(b->>1)::numeric then raise exception 'Invalid normalized evidence coordinates'; end if;
 end if; end loop; end
$$;
create function public.vexim_update_finding(fid uuid,p jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
 declare f public.findings; r public.reviews; refs uuid[]; pending boolean;
 begin select * into f from public.findings where id=fid; if not found then raise exception 'Finding unavailable' using errcode='42501'; end if; r:=public.app_editable_review(f.review_id);
 if length(trim(coalesce(p->>'reviewer_comment','')))<5 then raise exception 'Reviewer reason required'; end if;
 refs:=case when p ? 'citation_ids' then array(select jsonb_array_elements_text(p->'citation_ids')::uuid) else f.citation_ids end;
 if exists(select 1 from unnest(refs) ref where not exists(select 1 from public.regulatory_sources s where s.id=ref)) then raise exception 'Citation outside registry'; end if;
 pending:=cardinality(refs)=0 or exists(select 1 from public.regulatory_sources s where s.id=any(refs) and not public.app_source_current(s));
 update public.findings set severity=(p->>'severity')::public.finding_severity,status=(p->>'status')::public.finding_status,reviewer_comment=trim(p->>'reviewer_comment'),citation_ids=refs,citation_pending=pending,reviewed_by=auth.uid(),reviewed_at=now() where id=fid returning * into f; return to_jsonb(f); end
$$;
create function public.vexim_add_finding(rid uuid,p jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
 declare r public.reviews; f public.findings; refs uuid[];
 begin r:=public.app_editable_review(rid); perform public.app_validate_evidence(p->'evidence',r.label_version_id);
 if length(trim(p->>'title'))<2 or length(trim(p->>'description'))<10 or length(trim(p->>'suggested_action'))<2 then raise exception 'Finding content required'; end if;
 if ((p->>'title')||' '||(p->>'description')||' '||(p->>'suggested_action')) ~* '(FDA (approved|certified)|guaranteed customs clearance|100% legal)' then raise exception 'Forbidden absolute claim'; end if;
 refs:=array(select jsonb_array_elements_text(coalesce(p->'citation_ids','[]'))::uuid); if exists(select 1 from unnest(refs) ref where not exists(select 1 from public.regulatory_sources where id=ref)) then raise exception 'Citation outside registry'; end if;
 insert into public.findings(review_id,organization_id,rule_key,rule_version,severity,title,description,evidence,citation_ids,citation_pending,suggested_action,reasoning_category) values(rid,r.organization_id,'MANUAL',1,(p->>'severity')::public.finding_severity,p->>'title',p->>'description',p->'evidence',refs,cardinality(refs)=0 or exists(select 1 from public.regulatory_sources s where s.id=any(refs) and not public.app_source_current(s)),p->>'suggested_action','manual') returning * into f; return to_jsonb(f); end
$$;
create function public.vexim_update_field(lid uuid,fid uuid,new_value text,reason text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
 declare r public.reviews;
 begin select * into r from public.reviews where label_version_id=lid; if not found then raise exception 'Review unavailable'; end if; r:=public.app_editable_review(r.id);
 if length(trim(reason))<5 then raise exception 'Reason required'; end if;
 update public.extracted_fields set value=nullif(new_value,''),manually_verified=true,confidence=1,extraction_model='human-verified' where id=fid and label_version_id=lid; if not found then raise exception 'Field unavailable'; end if;
 update public.reviews set rule_snapshot='[]',missing_information=array_append(missing_information,'Extracted value changed. Re-run rules before report approval.') where id=r.id;
 perform public.app_write_audit(r.organization_id,'extraction.verified','label_version',lid::text,reason,jsonb_build_object('field_id',fid,'evidence_preserved',true)); end
$$;
create function public.vexim_request_information(rid uuid,message text,documents text[]) returns void language plpgsql security definer set search_path=public,pg_temp as $$
 declare r public.reviews;
 begin r:=public.app_editable_review(rid); if r.status not in ('HUMAN_REVIEW','REVISION_REQUIRED','MANUAL_ESCALATION_REQUIRED','WAITING_FOR_CUSTOMER') then raise exception 'Invalid review stage for information request'; end if;
 insert into public.customer_requests(review_id,organization_id,message,requested_documents,created_by) values(rid,r.organization_id,trim(message),documents,auth.uid()); update public.reviews set status='WAITING_FOR_CUSTOMER',updated_at=now() where id=rid; end
$$;
create function public.vexim_resolve_request(request_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
 declare q public.customer_requests; r public.reviews;
 begin select * into q from public.customer_requests where id=request_id; if not found then raise exception 'Request unavailable'; end if; r:=public.app_editable_review(q.review_id);
 update public.customer_requests set status='resolved' where id=request_id;
 if not exists(select 1 from public.customer_requests where review_id=q.review_id and status='open') and r.status='WAITING_FOR_CUSTOMER' then update public.reviews set status='HUMAN_REVIEW',updated_at=now() where id=r.id; end if; end
$$;
create function public.vexim_transition_review(rid uuid,target public.review_status,reason text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
 declare r public.reviews; allowed boolean:=false;
 begin select * into r from public.reviews where id=rid for update; if not found or not coalesce(public.app_can_read_org(r.organization_id),false) then raise exception 'Review unavailable' using errcode='42501'; end if;
 if length(trim(reason))<5 then raise exception 'Reason required'; end if;
 if target='ARCHIVED' then allowed:=r.status in ('DRAFT','INTAKE_PENDING','WAITING_FOR_CUSTOMER','REVISION_REQUIRED','COMPLETED','PROCESSING_FAILED','SOURCE_UNAVAILABLE','MODEL_FAILED','MANUAL_ESCALATION_REQUIRED') and (public.app_staff() in ('reviewer','system_admin') or public.app_can_admin_org(r.organization_id));
 else perform public.app_require_staff('reviewer'); allowed:=case r.status when 'AI_REVIEW_READY' then target='HUMAN_REVIEW' when 'HUMAN_REVIEW' then target in ('WAITING_FOR_CUSTOMER','REVISION_REQUIRED','MANUAL_ESCALATION_REQUIRED') when 'WAITING_FOR_CUSTOMER' then target in ('HUMAN_REVIEW','REVISION_REQUIRED') when 'REVISION_REQUIRED' then target='HUMAN_REVIEW' when 'SOURCE_UNAVAILABLE' then target='HUMAN_REVIEW' when 'MANUAL_ESCALATION_REQUIRED' then target in ('HUMAN_REVIEW','WAITING_FOR_CUSTOMER') else false end; end if;
 if not coalesce(allowed,false) then raise exception 'Invalid state transition'; end if; update public.reviews set status=target,updated_at=now() where id=rid;
 perform public.app_write_audit(r.organization_id,'review.status_changed','review',rid::text,reason,jsonb_build_object('from',r.status,'to',target)); end
$$;
create function public.vexim_retry_review(rid uuid,stage text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
 declare r public.reviews; j public.pipeline_jobs;
 begin r:=public.app_editable_review(rid); if stage not in ('validation','ocr','extraction','rules','verification') then raise exception 'Invalid stage'; end if;
 select * into j from public.pipeline_jobs where review_id=rid for update;
 if j.status='running' and j.locked_until>now() then raise exception 'Worker is already running this review'; end if;
 update public.pipeline_jobs set status='queued',from_stage=stage,current_stage=stage,attempts=0,next_run_at=now(),locked_by=null,locked_until=null,last_error=null,updated_at=now() where review_id=rid;
 update public.reviews set status='PROCESSING',error_message=null,rule_snapshot='[]',updated_at=now(),pipeline=(select jsonb_agg(case when (s->>'stage') in (select x from unnest(array['validation','ocr','extraction','rules','verification']) with ordinality a(x,n) where n>=array_position(array['validation','ocr','extraction','rules','verification'],stage)) then jsonb_set(s,'{status}','"pending"') else s end) from jsonb_array_elements(r.pipeline) s) where id=rid;
 perform public.app_write_audit(r.organization_id,'review.retried','review',rid::text,'Retry from '||stage,jsonb_build_object('stage',stage)); end
$$;
create function public.vexim_save_source(p jsonb) returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
 declare sid uuid:=coalesce(nullif(p->>'id','')::uuid,gen_random_uuid()); oldsource public.regulatory_sources; ver integer; excerpt text:=p->>'content_excerpt';
 begin perform public.app_require_staff('regulatory_admin'); select * into oldsource from public.regulatory_sources where id=sid for update;
 if found then ver:=oldsource.version+1; insert into public.regulatory_source_versions(source_id,version,snapshot) values(sid,oldsource.version,to_jsonb(oldsource)); else ver:=1; end if;
 if length(trim(excerpt))<80 or nullif(p->>'retrieved_at','') is null or (p->>'retrieved_at')::timestamptz>now()+interval '5 minutes' then raise exception 'Retrieved source snapshot required'; end if;
 insert into public.regulatory_sources(id,source_key,authority,agency,document_type,citation,title,canonical_url,topic,priority,retrieved_at,effective_from,effective_to,content_hash,content_excerpt,version,created_by)
 values(sid,p->>'source_key',coalesce(p->>'authority','FDA'),p->>'agency',p->>'document_type',p->>'citation',p->>'title',p->>'canonical_url',p->>'topic',(p->>'priority')::integer,(p->>'retrieved_at')::timestamptz,nullif(p->>'effective_from','')::date,nullif(p->>'effective_to','')::date,encode(extensions.digest(convert_to(excerpt,'UTF8'),'sha256'),'hex'),excerpt,ver,auth.uid())
 on conflict(id) do update set source_key=excluded.source_key,authority=excluded.authority,agency=excluded.agency,document_type=excluded.document_type,citation=excluded.citation,title=excluded.title,canonical_url=excluded.canonical_url,topic=excluded.topic,priority=excluded.priority,retrieved_at=excluded.retrieved_at,effective_from=excluded.effective_from,effective_to=excluded.effective_to,content_hash=excluded.content_hash,content_excerpt=excluded.content_excerpt,version=excluded.version,created_by=excluded.created_by,status='DRAFT',approved_by=null,approved_at=null,updated_at=now();
 update public.regulatory_chunks set review_status='SUPERSEDED' where source_id=sid and review_status='APPROVED';
 insert into public.regulatory_chunks(source_id,source_version,citation,heading,content,topic,obligation_type,effective_from,effective_to) select id,version,citation,title,content_excerpt,topic,document_type,effective_from,effective_to from public.regulatory_sources where id=sid;
 return (select to_jsonb(s) from public.regulatory_sources s where id=sid); end
$$;
create function public.vexim_approve_source(sid uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
 declare s public.regulatory_sources;
 begin perform public.app_require_staff('regulatory_admin'); select * into s from public.regulatory_sources where id=sid for update;
 if not found or s.status<>'DRAFT' or s.created_by=auth.uid() or s.created_by is null or s.retrieved_at is null or s.content_hash is null or length(s.content_excerpt)<80 then raise exception 'Independent approver and valid snapshot required'; end if;
 if (s.effective_to is not null and s.effective_to<current_date) or (s.effective_from is not null and s.effective_from>current_date) then raise exception 'Source not currently effective'; end if;
 update public.regulatory_sources set status='CURRENT',approved_by=auth.uid(),approved_at=now(),updated_at=now() where id=sid;
 update public.regulatory_chunks set review_status='APPROVED',approved_by=auth.uid(),approved_at=now() where source_id=sid and source_version=s.version;
 perform public.app_write_audit(null,'source.approved','source',sid::text,'Approved '||s.citation||' v'||s.version,jsonb_build_object('content_hash',s.content_hash)); end
$$;
create function public.vexim_save_rule(p jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
 declare rid uuid:=coalesce(nullif(p->>'id','')::uuid,gen_random_uuid()); oldrule public.compliance_rules; ver integer; refs uuid[]; key text:=p->>'rule_key';
 begin perform public.app_require_staff('regulatory_admin');
 if key not in ('IDENTITY-001','NETQTY-001','INGREDIENT-001','NUTRITION-001','NUTRITION-002','ALLERGEN-001','ALLERGEN-002','CLAIM-001','CLAIM-002','CLAIM-003','FORMULA-001','LABEL-001','LABEL-002','PARTY-001','CLASS-001') then raise exception 'Unsupported deterministic evaluator'; end if;
 if not coalesce(jsonb_typeof(p->'condition_json')='object' and jsonb_typeof(p->'action_json')='object' and (p->'condition_json'->>'ocr_threshold')::numeric between 0 and 1 and p->'action_json'->>'severity' in ('critical','major','minor','information') and jsonb_typeof(p->'action_json'->'human_review')='boolean' and length(trim(p->'action_json'->>'suggested_action'))>=2,false) then raise exception 'Invalid rule schema'; end if;
 refs:=array(select jsonb_array_elements_text(p->'source_citations')::uuid); if cardinality(refs)=0 or exists(select 1 from unnest(refs) ref where not exists(select 1 from public.regulatory_sources where id=ref)) then raise exception 'Citation outside registry'; end if;
 perform pg_advisory_xact_lock(hashtext(key)); select * into oldrule from public.compliance_rules where id=rid for update;
 if found and oldrule.rule_key<>key then raise exception 'Rule key immutable'; end if;
 if found and oldrule.status='DRAFT' then ver:=oldrule.version; else rid:=gen_random_uuid(); select coalesce(max(version),0)+1 into ver from public.compliance_rules where rule_key=key; end if;
 insert into public.compliance_rules(id,rule_key,name,version,scope,condition_json,action_json,source_citations,effective_from,effective_to,created_by)
 values(rid,key,p->>'name',ver,array(select jsonb_array_elements_text(p->'scope')),p->'condition_json',p->'action_json',refs,nullif(p->>'effective_from','')::date,nullif(p->>'effective_to','')::date,auth.uid())
 on conflict(id) do update set name=excluded.name,scope=excluded.scope,condition_json=excluded.condition_json,action_json=excluded.action_json,source_citations=excluded.source_citations,effective_from=excluded.effective_from,effective_to=excluded.effective_to,created_by=auth.uid(),test_status='pending',test_hash=null,test_source_snapshot=null,updated_at=now();
 return (select to_jsonb(r) from public.compliance_rules r where id=rid); end
$$;
create function public.vexim_record_rule_test(rid uuid,expected_hash text,source_refs jsonb,results jsonb,tester uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
 declare r public.compliance_rules; passed boolean;
 begin perform public.app_require_service(); select * into r from public.compliance_rules where id=rid for update;
 if not found or r.definition_hash is distinct from expected_hash or public.app_source_refs(r.source_citations) is distinct from source_refs then raise exception 'Rule or source changed during test'; end if;
 passed:=jsonb_array_length(results)=15 and (select count(distinct e->>'rule_key') from jsonb_array_elements(results) e)=15 and not exists(select 1 from jsonb_array_elements(results) e where e->>'rule_key' not in ('IDENTITY-001','NETQTY-001','INGREDIENT-001','NUTRITION-001','NUTRITION-002','ALLERGEN-001','ALLERGEN-002','CLAIM-001','CLAIM-002','CLAIM-003','FORMULA-001','LABEL-001','LABEL-002','PARTY-001','CLASS-001') or jsonb_typeof(e->'passed') is distinct from 'boolean' or e->>'passed'<>'true');
 insert into public.rule_test_runs(rule_id,definition_hash,results,tested_by) values(rid,expected_hash,results,tester);
 update public.compliance_rules set status=case when status='ACTIVE' and not passed then 'SUPERSEDED' else status end,test_status=case when passed then 'passed' else 'failed' end,test_hash=expected_hash,test_source_snapshot=source_refs where id=rid; end
$$;
create function public.vexim_approve_rule(rid uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
 declare r public.compliance_rules;
 begin perform public.app_require_staff('regulatory_admin'); select * into r from public.compliance_rules where id=rid for update;
 if not found or r.status<>'DRAFT' or r.created_by is null or r.created_by=auth.uid() or r.test_status<>'passed' or r.test_hash is distinct from r.definition_hash or r.test_source_snapshot is distinct from public.app_source_refs(r.source_citations) then raise exception 'Independent approval and fresh regression test required'; end if;
 if exists(select 1 from public.regulatory_sources s where s.id=any(r.source_citations) and not public.app_source_current(s)) or (r.effective_from is not null and r.effective_from>current_date) or (r.effective_to is not null and r.effective_to<current_date) then raise exception 'Source or rule not currently effective'; end if;
 perform pg_advisory_xact_lock(hashtext(r.rule_key)); update public.compliance_rules set status='SUPERSEDED' where rule_key=r.rule_key and status='ACTIVE';
 update public.compliance_rules set status='ACTIVE',approved_by=auth.uid(),source_snapshot=public.app_source_refs(source_citations),updated_at=now() where id=rid;
 perform public.app_write_audit(null,'rule.approved','rule',rid::text,'Activated '||r.rule_key||' v'||r.version,jsonb_build_object('sources',public.app_source_refs(r.source_citations))); end
$$;
create function public.vexim_set_member_status(mid uuid,new_status text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
 declare m public.organization_members;
 begin select * into m from public.organization_members where id=mid for update; if not found or not public.app_can_admin_org(m.organization_id) or m.user_id=auth.uid() then raise exception 'Organization admin required, cannot self-lock' using errcode='42501'; end if;
 if new_status not in ('active','locked') or m.status='invited' then raise exception 'Invalid member status'; end if;
 if new_status='locked' and m.role='customer_admin' and not exists(select 1 from public.organization_members where organization_id=m.organization_id and role='customer_admin' and status='active' and id<>mid) then raise exception 'Cannot lock the last customer admin'; end if;
 update public.organization_members set status=new_status where id=mid; end
$$;

create function public.vexim_add_invited_member(org uuid,uid uuid,new_role public.member_role) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
 declare m public.organization_members;
 begin if not public.app_can_admin_org(org) then raise exception 'Organization admin required' using errcode='42501'; end if;
 if not exists(select 1 from public.profiles where id=uid and staff_role is null) then raise exception 'Customer accounts only'; end if;
 if (select count(*) from public.organization_members where organization_id=org)>=100 then raise exception 'Organization member limit reached'; end if;
 insert into public.organization_members(organization_id,user_id,role,status) values(org,uid,new_role,'invited') returning * into m; return to_jsonb(m); end
$$;
create function public.vexim_accept_memberships() returns void language plpgsql security definer set search_path=public,pg_temp as $$
 begin if not public.app_is_active() or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then return; end if;
 update public.organization_members set status='active' where user_id=auth.uid() and status='invited'; end
$$;

-- Database constructs report snapshots; callers cannot provide a fake approved result.
create function public.vexim_approve_report(rid uuid,comment text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
 declare r public.reviews; existing public.reports; record public.reports; outcome text; snapshot jsonb; reviewer_name text; sources jsonb; allfindings jsonb; ref jsonb; rule jsonb; disclaimer text;
 begin perform public.app_require_staff('reviewer'); select * into r from public.reviews where id=rid for update;
 if not found or not public.app_can_read_org(r.organization_id) then raise exception 'Review unavailable' using errcode='42501'; end if;
 select * into existing from public.reports where review_id=rid; if found then return to_jsonb(existing); end if;
 if exists(select 1 from public.label_files f where f.label_version_id=r.label_version_id and f.kind='original' and f.scan_status<>'clean') then raise exception 'Every original must pass malware scan before final report'; end if;
 if r.status not in ('HUMAN_REVIEW','REVISION_REQUIRED') or length(trim(comment))<10 or jsonb_array_length(r.rule_snapshot)<15 or exists(select 1 from jsonb_array_elements(r.pipeline) s where s->>'status'<>'complete') then raise exception 'Incomplete review or ruleset snapshot'; end if;
 if exists(select 1 from public.findings f where f.review_id=rid and (f.status='open' or f.reviewed_by is null or length(trim(f.reviewer_comment))<5)) then raise exception 'Every finding must have a reasoned reviewer decision'; end if;
 if exists(select 1 from public.findings f where f.review_id=rid and f.status='accepted' and f.severity in ('critical','major') and (f.citation_pending or cardinality(f.citation_ids)=0 or exists(select 1 from public.regulatory_sources s where s.id=any(f.citation_ids) and not public.app_source_current(s)))) then raise exception 'Major/Critical finding requires current registry citation'; end if;
 for rule in select * from jsonb_array_elements(r.rule_snapshot) loop
 if not exists(select 1 from public.compliance_rules cr where cr.rule_key=rule->>'rule_key' and cr.version=(rule->>'version')::integer and cr.status='ACTIVE' and cr.source_snapshot @> (rule->'source_versions') and (rule->'source_versions') @> cr.source_snapshot and (cr.effective_from is null or cr.effective_from<=current_date) and (cr.effective_to is null or cr.effective_to>=current_date)) then raise exception 'Ruleset changed or expired; rerun review'; end if;
 if jsonb_array_length(rule->'source_versions')=0 then raise exception 'Ruleset source snapshot missing'; end if;
 for ref in select * from jsonb_array_elements(rule->'source_versions') loop
 if not exists(select 1 from public.regulatory_sources s where s.id=(ref->>'id')::uuid and s.version=(ref->>'version')::integer and s.content_hash=ref->>'content_hash' and public.app_source_current(s)) then raise exception 'Source changed or expired; rerun review'; end if;
 end loop; end loop;
 outcome:=case when exists(select 1 from public.findings where review_id=rid and status='accepted' and severity in ('critical','major')) then 'NEEDS_CORRECTION' when cardinality(r.missing_information)>0 or exists(select 1 from public.customer_requests where review_id=rid and status='open') then 'INSUFFICIENT_INFORMATION' else 'NO_ISSUE_DETECTED_IN_SCOPE' end;
 select full_name into reviewer_name from public.profiles where id=auth.uid();
 select coalesce(jsonb_agg(to_jsonb(f) order by f.severity,f.created_at),'[]') into allfindings from public.findings f where review_id=rid;
 select coalesce(jsonb_agg(to_jsonb(s) order by s.priority,s.id),'[]') into sources from public.regulatory_sources s where s.id in (select unnest(f.citation_ids) from public.findings f where f.review_id=rid union select (source_ref.value->>'id')::uuid from jsonb_array_elements(r.rule_snapshot) ru cross join lateral jsonb_array_elements(ru->'source_versions') as source_ref(value));
 disclaimer:='Đây là đánh giá sơ bộ trong phạm vi nhãn thực phẩm liên bang Hoa Kỳ, dựa trên dữ liệu được cung cấp và phiên bản nguồn / quy tắc tại thời điểm rà soát. Báo cáo không phải phê duyệt hoặc chứng nhận của FDA, không bảo đảm thông quan và không thay thế tư vấn pháp lý. Kết luận phải được chuyên viên Vexim xác nhận.'||chr(10)||chr(10)||'This is a preliminary review within the stated US federal food-labeling scope, based on supplied information and recorded source/rule versions. It is not FDA approval or certification, does not guarantee customs clearance, and is not a substitute for legal advice.';
 snapshot:=jsonb_build_object('schema_version','1.0','review_id',rid,'product',r.dossier_snapshot,'label_version',public.app_label_json(r.label_version_id),'review_scope',r.review_scope,'result',outcome,'disclaimer',disclaimer,'findings',allfindings,'sources',sources,'reviewer',jsonb_build_object('id',auth.uid(),'name',reviewer_name,'approved_at',now(),'comment',trim(comment)),'version_history',coalesce((select jsonb_agg(jsonb_build_object('version',version,'uploaded_at',uploaded_at) order by version) from public.label_versions where product_id=r.product_id),'[]'),'missing_information',to_jsonb(r.missing_information),'customer_requests',coalesce((select jsonb_agg(to_jsonb(q)) from public.customer_requests q where q.review_id=rid),'[]'),'rule_snapshot',r.rule_snapshot,'generated_at',now(),'demo',false);
 insert into public.reports(review_id,organization_id,product_id,label_version_id,snapshot) values(rid,r.organization_id,r.product_id,r.label_version_id,snapshot) returning * into record;
 update public.reviews set status='APPROVED_WITH_NOTES',approved_by=auth.uid(),approved_at=now(),approval_comment=trim(comment),updated_at=now() where id=rid;
 perform public.app_write_audit(r.organization_id,'report.approved','report',record.id::text,'Reviewer approved report content, not FDA approval',jsonb_build_object('result',outcome)); return to_jsonb(record); end
$$;
create function public.vexim_log_file_access(fid uuid,access_action text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
 declare f public.label_files;
 begin select * into f from public.label_files where id=fid; if not found or not public.app_can_read_org(f.organization_id) or f.scan_status<>'clean' then raise exception 'File unavailable' using errcode='42501'; end if;
 if access_action not in ('view','download','signed_url') then raise exception 'Invalid access action'; end if;
 perform public.app_write_audit(f.organization_id,'file.'||access_action,'label_version',f.label_version_id::text,access_action||' '||f.name,jsonb_build_object('file_id',fid)); end
$$;
create function public.vexim_log_report_download(report_id uuid,format text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
 declare r public.reports;
 begin select * into r from public.reports where id=report_id; if not found or not public.app_can_read_org(r.organization_id) then raise exception 'Report unavailable' using errcode='42501'; end if;
 if format not in ('pdf','json') then raise exception 'Invalid format'; end if;
 perform public.app_write_audit(r.organization_id,'report.downloaded','report',r.id::text,'Downloaded '||r.report_number||' as '||format,'{}'); end
$$;
create function public.vexim_customer_citations() returns setof public.regulatory_sources language sql stable security definer set search_path=public,pg_temp as $$
 select s.* from public.regulatory_sources s where public.app_is_active() and exists(select 1 from public.findings f where s.id=any(f.citation_ids) and public.app_can_read_org(f.organization_id))
$$;

-- Queue lease, retry budget and dead-letter handling are service-only.
create function public.vexim_claim_job(worker_id text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
 declare j public.pipeline_jobs;
 begin perform public.app_require_service();
 update public.pipeline_jobs set status='dead_letter',last_error=coalesce(last_error,'Lease expired after retry budget'),updated_at=now() where status='running' and locked_until<now() and attempts>=3;
 update public.reviews r set status='PROCESSING_FAILED',error_message=expired.last_error,updated_at=now() from public.pipeline_jobs expired where expired.review_id=r.id and expired.status='dead_letter' and r.status='PROCESSING';
 select * into j from public.pipeline_jobs where attempts<3 and ((status in ('queued','retry') and next_run_at<=now()) or (status='running' and locked_until<now())) order by next_run_at for update skip locked limit 1;
 if not found then return null; end if;
 update public.pipeline_jobs set status='running',attempts=attempts+1,locked_by=worker_id,locked_until=now()+interval '6 minutes',updated_at=now() where id=j.id returning * into j; return to_jsonb(j); end
$$;
create function public.vexim_heartbeat_job(jid uuid,worker_id text) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
 begin perform public.app_require_service(); update public.pipeline_jobs set locked_until=now()+interval '6 minutes',updated_at=now() where id=jid and locked_by=worker_id and status='running' and locked_until>now(); return found; end
$$;
create function public.vexim_fail_job(jid uuid,worker_id text,message text,terminal boolean default false) returns void language plpgsql security definer set search_path=public,pg_temp as $$
 declare j public.pipeline_jobs;
 begin perform public.app_require_service(); select * into j from public.pipeline_jobs where id=jid and locked_by=worker_id and status='running' and locked_until>now() for update; if not found then raise exception 'Lease owner mismatch'; end if;
 update public.pipeline_jobs set status=case when terminal or attempts>=3 then 'dead_letter' else 'retry' end,last_error=left(message,2000),next_run_at=now()+make_interval(secs=>power(2,j.attempts)::integer*3),locked_by=null,locked_until=null,updated_at=now() where id=jid;
 update public.reviews set status=case when terminal or j.attempts>=3 then 'PROCESSING_FAILED'::public.review_status else 'PROCESSING'::public.review_status end,error_message=left(message,2000),updated_at=now(),pipeline=(select jsonb_agg(case when s->>'stage'=j.current_stage then s||jsonb_build_object('status','failed','message',left(message,1000),'attempts',j.attempts) else s end) from jsonb_array_elements(pipeline) s) where id=j.review_id;
 perform public.app_write_audit(j.organization_id,'review.failed','review',j.review_id::text,left(message,2000),jsonb_build_object('attempt',j.attempts,'terminal',terminal or j.attempts>=3)); end
$$;
create function public.vexim_set_job_progress(jid uuid,worker_id text,stage_name text,pipeline_json jsonb,progress_value integer) returns void language plpgsql security definer set search_path=public,pg_temp as $$
 declare j public.pipeline_jobs;
 begin perform public.app_require_service();
 select * into j from public.pipeline_jobs where id=jid and status='running' and locked_by=worker_id and locked_until>now() for update;
 if not found then raise exception 'Lease lost'; end if;
 if stage_name not in ('validation','ocr','extraction','rules','verification') or progress_value not between 0 and 99 or jsonb_typeof(pipeline_json)<>'array' or jsonb_array_length(pipeline_json)<>5 then raise exception 'Invalid progress metadata'; end if;
 update public.reviews set pipeline=pipeline_json,progress=progress_value,updated_at=now() where id=j.review_id and status='PROCESSING';
 update public.pipeline_jobs set current_stage=stage_name,locked_until=now()+interval '6 minutes',updated_at=now() where id=jid;
 end
$$;
create function public.vexim_mark_file_scanned(jid uuid,worker_id text,fid uuid,result text,page_total integer default null) returns void language plpgsql security definer set search_path=public,pg_temp as $$
 declare j public.pipeline_jobs; r public.reviews;
 begin perform public.app_require_service(); select * into j from public.pipeline_jobs where id=jid and status='running' and locked_by=worker_id and locked_until>now() for update; if not found then raise exception 'Lease mismatch'; end if;
 select * into r from public.reviews where id=j.review_id; if result not in ('clean','rejected','dev_unscanned') then raise exception 'Invalid scan result'; end if;
 update public.label_files set scan_status=result,page_count=coalesce(page_total,page_count) where id=fid and label_version_id=r.label_version_id and kind='original'; if not found then raise exception 'File outside review'; end if; end
$$;
create function public.vexim_store_normalized(jid uuid,worker_id text,manifest jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
 declare j public.pipeline_jobs; r public.reviews; f public.label_files; result jsonb:='[]'; p jsonb; orig public.label_files; fid uuid;
 begin perform public.app_require_service(); select * into j from public.pipeline_jobs where id=jid and status='running' and locked_by=worker_id and locked_until>now() for update; if not found then raise exception 'Lease mismatch'; end if;
 select * into r from public.reviews where id=j.review_id;
 for p in select * from jsonb_array_elements(manifest) loop
 select * into orig from public.label_files where id=(p->>'original_file_id')::uuid and label_version_id=r.label_version_id and kind='original' and scan_status in ('clean','dev_unscanned'); if not found then raise exception 'Unscanned or mismatched original'; end if;
 select * into f from public.label_files where original_file_id=orig.id and page=(p->>'page')::integer and kind='normalized'; fid:=coalesce(f.id,gen_random_uuid());
 insert into public.label_files(id,label_version_id,organization_id,name,mime_type,size,storage_path,sha256,page_count,scan_status,kind,original_file_id,page)
 values(fid,r.label_version_id,r.organization_id,p->>'name','image/png',(p->>'size')::bigint,r.organization_id::text||'/'||r.label_version_id::text||'/normalized/'||orig.id::text||'/'||(p->>'page')||'-'||(p->>'sha256')||'.png',p->>'sha256',1,orig.scan_status,'normalized',orig.id,(p->>'page')::integer)
 on conflict(id) do update set name=excluded.name,size=excluded.size,storage_path=excluded.storage_path,sha256=excluded.sha256,scan_status=excluded.scan_status returning * into f;
 result:=result||jsonb_build_array(to_jsonb(f)); end loop; return result; end
$$;
create function public.vexim_save_pipeline_output(jid uuid,worker_id text,stage_name text,payload_json jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$
 declare j public.pipeline_jobs; r public.reviews; f jsonb;
 begin perform public.app_require_service(); select * into j from public.pipeline_jobs where id=jid and status='running' and locked_by=worker_id and locked_until>now() for update; if not found then raise exception 'Lease mismatch'; end if;
 select * into r from public.reviews where id=j.review_id;
 insert into public.pipeline_outputs(job_id,review_id,organization_id,stage,payload) values(jid,r.id,r.organization_id,stage_name,payload_json) on conflict(job_id,stage) do update set payload=excluded.payload,created_at=now();
 if stage_name='extraction' then
 delete from public.extracted_fields where label_version_id=r.label_version_id;
 for f in select * from jsonb_array_elements(payload_json->'fields') loop
 perform public.app_validate_evidence(jsonb_build_array(f->'evidence'),r.label_version_id);
 insert into public.extracted_fields(organization_id,label_version_id,field,value,normalized,confidence,evidence,extraction_model,manually_verified)
 values(r.organization_id,r.label_version_id,f->>'field',f->>'value',f->'normalized',(f->>'confidence')::numeric,f->'evidence',f->>'extraction_model',coalesce((f->>'manually_verified')::boolean,false)); end loop; end if; end
$$;

create function public.vexim_complete_rules(jid uuid,worker_id text,new_findings jsonb,rule_refs jsonb,warnings text[],target public.review_status) returns void language plpgsql security definer set search_path=public,pg_temp as $$
 declare j public.pipeline_jobs; r public.reviews; f jsonb; refs uuid[];
 begin perform public.app_require_service(); select * into j from public.pipeline_jobs where id=jid and status='running' and locked_by=worker_id and locked_until>now() for update; if not found then raise exception 'Job lease expired'; end if;
 select * into r from public.reviews where id=j.review_id for update; if target not in ('HUMAN_REVIEW','SOURCE_UNAVAILABLE','MANUAL_ESCALATION_REQUIRED') then raise exception 'Pipeline may not approve a review'; end if;
 delete from public.findings where review_id=r.id;
 for f in select * from jsonb_array_elements(new_findings) loop
 perform public.app_validate_evidence(f->'evidence',r.label_version_id); refs:=array(select jsonb_array_elements_text(f->'citation_ids')::uuid);
 if exists(select 1 from unnest(refs) ref where not exists(select 1 from public.regulatory_sources where id=ref)) then raise exception 'Citation outside registry'; end if;
 if ((f->>'title')||' '||(f->>'description')||' '||(f->>'suggested_action')) ~* '(FDA (approved|certified)|guaranteed customs clearance|100% legal)' then raise exception 'Forbidden absolute claim'; end if;
 insert into public.findings(review_id,organization_id,rule_key,rule_version,severity,title,description,evidence,citation_ids,citation_pending,suggested_action,ai_confidence,reasoning_category,human_review_required)
 values(r.id,r.organization_id,f->>'rule_key',(f->>'rule_version')::integer,(f->>'severity')::public.finding_severity,f->>'title',f->>'description',f->'evidence',refs,cardinality(refs)=0 or exists(select 1 from public.regulatory_sources s where s.id=any(refs) and not public.app_source_current(s)),f->>'suggested_action',nullif(f->>'ai_confidence','')::numeric,f->>'reasoning_category',true);
 perform public.app_write_audit(r.organization_id,'rule.fired','review',r.id::text,(f->>'rule_key')||' v'||(f->>'rule_version'),jsonb_build_object('rule_key',f->>'rule_key'));
 end loop;
 update public.reviews set status=target,progress=100,rule_snapshot=rule_refs,missing_information=warnings,error_message=case when target='SOURCE_UNAVAILABLE' then 'Incomplete or unavailable approved ruleset' else null end,updated_at=now(),pipeline=(select jsonb_agg(s||jsonb_build_object('status','complete','completed_at',now())) from jsonb_array_elements(pipeline) s) where id=r.id;
 update public.label_versions set status='under_review' where id=r.label_version_id;
 update public.pipeline_jobs set status='completed',locked_by=null,locked_until=null,updated_at=now() where id=jid; end
$$;
create function public.vexim_match_regulatory_chunks(query_embedding extensions.vector(768),topic_filter text,category_filter text,match_count integer default 5) returns table(id uuid,citation text,content text,source_id uuid,source_version integer,content_hash text,similarity float) language sql stable security invoker set search_path=public,extensions,pg_temp as $$
 select c.id,c.citation,c.content,c.source_id,c.source_version,s.content_hash,1-(c.embedding<=>query_embedding) from public.regulatory_chunks c join public.regulatory_sources s on s.id=c.source_id
 where public.app_staff() is not null and public.app_source_current(s) and c.source_version=s.version and c.review_status='APPROVED' and c.jurisdiction='US' and c.language='en' and c.topic=topic_filter and c.applies_to ? category_filter and c.embedding is not null and (c.effective_from is null or c.effective_from<=current_date) and (c.effective_to is null or c.effective_to>=current_date)
 order by c.embedding<=>query_embedding limit least(greatest(match_count,1),20)
$$;

-- Private Storage. Original uploads can never be upserted/overwritten by users.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('label-originals','label-originals',false,52428800,array['application/pdf','image/png','image/jpeg','image/tiff']),
 ('label-normalized','label-normalized',false,52428800,array['image/png']),
 ('review-reports','review-reports',false,52428800,array['application/pdf','application/json'])
 on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy vexim_original_insert on storage.objects for insert to authenticated with check(bucket_id='label-originals' and exists(select 1 from public.label_files f where f.storage_path=storage.objects.name and f.kind='original' and f.scan_status='pending' and public.app_can_edit_org(f.organization_id)));
create policy vexim_original_read on storage.objects for select to authenticated using(bucket_id='label-originals' and exists(select 1 from public.label_files f where f.storage_path=storage.objects.name and f.kind='original' and f.scan_status='clean' and public.app_can_read_org(f.organization_id)));
create policy vexim_normalized_read on storage.objects for select to authenticated using(bucket_id='label-normalized' and exists(select 1 from public.label_files f where f.storage_path=storage.objects.name and f.kind='normalized' and f.scan_status='clean' and public.app_can_read_org(f.organization_id)));
create policy vexim_report_read on storage.objects for select to authenticated using(bucket_id='review-reports' and exists(select 1 from public.reports r where (r.pdf_path=storage.objects.name or r.json_path=storage.objects.name) and public.app_can_read_org(r.organization_id)));

-- Explicit grants: default PUBLIC EXECUTE on SECURITY DEFINER would bypass API/RLS.
grant usage on schema public,extensions to authenticated,service_role;
revoke all on all tables in schema public from anon,authenticated;
grant select on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage,select on all sequences in schema public to service_role;
revoke execute on all functions in schema public from public,anon,authenticated;
grant execute on function public.app_staff(),public.app_is_active(),public.app_can_read_org(uuid),public.app_can_edit_org(uuid),public.app_can_admin_org(uuid),public.app_source_current(public.regulatory_sources) to authenticated;
grant execute on function public.vexim_assign_review(uuid,uuid,text),public.vexim_add_invited_member(uuid,uuid,public.member_role),public.vexim_accept_memberships(),public.vexim_save_organization(jsonb),public.vexim_save_product(jsonb),public.vexim_create_label_version(uuid,jsonb),public.vexim_submit_review(uuid,text),public.vexim_update_finding(uuid,jsonb),public.vexim_add_finding(uuid,jsonb),public.vexim_update_field(uuid,uuid,text,text),public.vexim_request_information(uuid,text,text[]),public.vexim_resolve_request(uuid),public.vexim_transition_review(uuid,public.review_status,text),public.vexim_retry_review(uuid,text),public.vexim_save_source(jsonb),public.vexim_approve_source(uuid),public.vexim_save_rule(jsonb),public.vexim_approve_rule(uuid),public.vexim_set_member_status(uuid,text),public.vexim_approve_report(uuid,text),public.vexim_log_file_access(uuid,text),public.vexim_log_report_download(uuid,text),public.vexim_customer_citations(),public.vexim_match_regulatory_chunks(extensions.vector,text,text,integer) to authenticated;
grant execute on all functions in schema public to service_role;
-- Internal helpers (product_json, label_json, app_write_audit, source_refs, etc.)
-- remain inaccessible to authenticated callers. They can only be called by guarded RPCs.

-- Optional realtime; workspace also has a 15s authenticated polling fallback.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
 alter publication supabase_realtime add table public.reviews,public.findings;
 end if;
 exception when duplicate_object then null;
 end $$;
commit;
