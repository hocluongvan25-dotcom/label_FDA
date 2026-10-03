-- Collaborative label review: separate the label owner, commercial importer,
-- and explicitly attested FSVP importer. This migration is additive and is not
-- applied to any remote database by the test suite.
begin;

create type public.review_party_role as enum (
  'label_owner',
  'commercial_importer',
  'fsvp_importer'
);
create type public.review_participant_status as enum (
  'invited',
  'active',
  'removed'
);
create type public.review_party_decision as enum (
  'accepted',
  'changes_requested',
  'proposed_edit'
);
create type public.review_collaboration_status as enum (
  'not_shared',
  'awaiting_importer',
  'changes_requested',
  'mutually_accepted'
);

alter table public.reviews
  add column collaboration_status public.review_collaboration_status not null default 'not_shared';

create table public.review_participants (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),
  organization_name_snapshot text not null check(length(organization_name_snapshot) between 2 and 300),
  party_role public.review_party_role not null,
  status public.review_participant_status not null default 'invited',
  invited_by uuid not null references public.profiles(id),
  invited_at timestamptz not null default now(),
  activated_by uuid references public.profiles(id),
  activated_at timestamptz,
  fsvp_attested_by uuid references public.profiles(id),
  fsvp_attested_at timestamptz,
  fsvp_attestation_note text,
  created_at timestamptz not null default now(),
  unique(review_id, organization_id, party_role),
  unique(id, party_role),
  check (status <> 'active' or (activated_at is not null and activated_by is not null)),
  check (status <> 'invited' or (activated_at is null and activated_by is null)),
  check (
    (party_role = 'fsvp_importer' and
      ((fsvp_attested_at is null and fsvp_attested_by is null and fsvp_attestation_note is null) or
       (fsvp_attested_at is not null and fsvp_attested_by is not null and fsvp_attestation_note is not null and length(trim(fsvp_attestation_note)) >= 10)))
    or
    (party_role <> 'fsvp_importer' and fsvp_attested_at is null and fsvp_attested_by is null and fsvp_attestation_note is null)
  ),
  check (party_role <> 'fsvp_importer' or status <> 'active' or fsvp_attested_at is not null)
);
create index review_participants_org on public.review_participants(organization_id, status, review_id);
create unique index one_label_owner_per_review
  on public.review_participants(review_id)
  where party_role = 'label_owner';
create unique index one_live_commercial_importer_per_review
  on public.review_participants(review_id)
  where party_role = 'commercial_importer' and status <> 'removed';
create unique index one_live_fsvp_importer_per_review
  on public.review_participants(review_id)
  where party_role = 'fsvp_importer' and status <> 'removed';

create function public.app_review_participant_identity_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare owner_org uuid;
begin
  if tg_op='UPDATE' and (
    old.review_id is distinct from new.review_id
    or old.organization_id is distinct from new.organization_id
    or old.party_role is distinct from new.party_role
  ) then
    raise exception 'Review participant identity is immutable';
  end if;
  select r.organization_id into owner_org from public.reviews r where r.id=new.review_id;
  if owner_org is null then raise exception 'Review unavailable'; end if;
  if new.party_role='label_owner' then
    if new.organization_id<>owner_org or new.status<>'active' then
      raise exception 'The label-owner participant must match the review owner and remain active';
    end if;
  elsif new.organization_id=owner_org then
    raise exception 'Importer participants must be a separate organization';
  end if;
  return new;
end
$$;
create trigger review_participant_identity_guard
  before insert or update on public.review_participants
  for each row execute function public.app_review_participant_identity_guard();

-- Existing review owner organizations are explicit participants after migration.
insert into public.review_participants(
  review_id, organization_id, organization_name_snapshot, party_role, status,
  invited_by, invited_at, activated_by, activated_at
)
select r.id, r.organization_id, o.name, 'label_owner', 'active',
       r.requested_by, r.created_at, r.requested_by, r.created_at
from public.reviews r
join public.organizations o on o.id = r.organization_id
on conflict(review_id, organization_id, party_role) do nothing;

create function public.app_add_review_owner_participant()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare organization_name text;
begin
  select o.name into organization_name
  from public.organizations o where o.id = new.organization_id;
  if organization_name is null then
    raise exception 'Review owner organization unavailable';
  end if;
  insert into public.review_participants(
    review_id, organization_id, organization_name_snapshot, party_role,
    status, invited_by, invited_at, activated_by, activated_at
  ) values (
    new.id, new.organization_id, organization_name, 'label_owner',
    'active', new.requested_by, new.created_at, new.requested_by, new.created_at
  ) on conflict(review_id, organization_id, party_role) do nothing;
  return new;
end
$$;
create trigger review_owner_participant_after_insert
  after insert on public.reviews
  for each row execute function public.app_add_review_owner_participant();

create table public.review_party_decisions (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete restrict,
  label_version_id uuid not null references public.label_versions(id) on delete restrict,
  participant_id uuid not null,
  party_role public.review_party_role not null check(party_role in ('label_owner','commercial_importer')),
  decision public.review_party_decision not null,
  comment text not null check(length(trim(comment)) between 5 and 10000),
  proposed_changes jsonb not null default '[]'::jsonb check(jsonb_typeof(proposed_changes) = 'array'),
  label_bundle_sha256 text not null check(label_bundle_sha256 ~ '^[a-f0-9]{64}$'),
  actor_id uuid not null references public.profiles(id),
  actor_name_snapshot text not null check(length(trim(actor_name_snapshot)) between 1 and 300),
  created_at timestamptz not null default now(),
  foreign key(participant_id, party_role)
    references public.review_participants(id, party_role) on delete restrict,
  check (decision <> 'proposed_edit' or jsonb_array_length(proposed_changes) > 0),
  check (decision = 'proposed_edit' or jsonb_array_length(proposed_changes) = 0)
);
create index review_party_decisions_history
  on public.review_party_decisions(review_id, label_version_id, created_at desc);

create function public.app_review_party_decision_immutable()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  raise exception 'Review party decisions are append-only';
end
$$;
revoke execute on function public.app_review_party_decision_immutable() from public,anon,authenticated;
create trigger review_party_decisions_immutable
  before update or delete on public.review_party_decisions
  for each row execute function public.app_review_party_decision_immutable();

create function public.app_can_access_review(rid uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.app_is_active() and (
    coalesce(public.app_staff() in ('reviewer','system_admin'), false)
    or exists (
      select 1 from public.reviews r
      where r.id = rid and public.app_can_read_org(r.organization_id)
    )
    or exists (
      select 1
      from public.review_participants rp
      join public.organization_members m
        on m.organization_id = rp.organization_id
      join public.organizations o on o.id = rp.organization_id
      join public.reviews r on r.id = rp.review_id
      where rp.review_id = rid
        and rp.status = 'active'
        and (rp.party_role = 'label_owner' or r.collaboration_status <> 'not_shared')
        and m.user_id = auth.uid()
        and m.status = 'active'
        and o.status = 'active'
    )
  )
$$;

create function public.app_can_read_product(pid uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.app_is_active() and (
    exists(select 1 from public.products p where p.id = pid and public.app_can_read_org(p.organization_id))
    or exists(select 1 from public.reviews r where r.product_id = pid and public.app_can_access_review(r.id))
  )
$$;

create function public.app_can_read_label_version(lid uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.app_is_active() and (
    exists(select 1 from public.label_versions l where l.id = lid and public.app_can_read_org(l.organization_id))
    or exists(select 1 from public.reviews r where r.label_version_id = lid and public.app_can_access_review(r.id))
  )
$$;

-- Review access is scoped to explicitly active participants; it never grants
-- general access to the other organization's tenant or unrelated products.
drop policy tenant_read on public.products;
create policy tenant_read on public.products for select to authenticated
  using(public.app_can_read_org(organization_id) or public.app_can_read_product(id));
drop policy tenant_read on public.formula_ingredients;
create policy tenant_read on public.formula_ingredients for select to authenticated
  using(public.app_can_read_org(organization_id) or public.app_can_read_product(product_id));
drop policy tenant_read on public.label_versions;
create policy tenant_read on public.label_versions for select to authenticated
  using(public.app_can_read_org(organization_id) or public.app_can_read_label_version(id));
drop policy tenant_read on public.label_files;
create policy tenant_read on public.label_files for select to authenticated
  using(public.app_can_read_org(organization_id) or public.app_can_read_label_version(label_version_id));
drop policy tenant_read on public.extracted_fields;
create policy tenant_read on public.extracted_fields for select to authenticated
  using(public.app_can_read_org(organization_id) or public.app_can_read_label_version(label_version_id));
drop policy tenant_read on public.reviews;
create policy tenant_read on public.reviews for select to authenticated
  using(public.app_can_access_review(id));
drop policy tenant_read on public.findings;
create policy tenant_read on public.findings for select to authenticated
  using(public.app_can_access_review(review_id));
drop policy tenant_read on public.customer_requests;
create policy tenant_read on public.customer_requests for select to authenticated
  using(public.app_can_access_review(review_id));
drop policy tenant_read on public.reports;
create policy tenant_read on public.reports for select to authenticated
  using(public.app_can_access_review(review_id));

alter table public.review_participants enable row level security;
create policy review_participant_read on public.review_participants for select to authenticated
  using(
    public.app_can_access_review(review_id)
    or public.app_can_read_org(organization_id)
  );
alter table public.review_party_decisions enable row level security;
create policy review_party_decision_read on public.review_party_decisions for select to authenticated
  using(public.app_can_access_review(review_id));

-- Triage artifacts are review-scoped too, but their issuance flags and lifecycle
-- are intentionally unchanged by this collaboration migration.
drop policy triage_run_tenant_read on public.review_triage_runs;
create policy triage_run_tenant_read on public.review_triage_runs for select to authenticated
  using(public.app_can_access_review(review_id));
drop policy pre_screening_report_tenant_read on public.pre_screening_reports;
create policy pre_screening_report_tenant_read on public.pre_screening_reports for select to authenticated
  using(public.app_can_access_review(review_id));

-- Private file reads follow explicit review participation; uploads remain owner-only.
drop policy vexim_original_read on storage.objects;
create policy vexim_original_read on storage.objects for select to authenticated
  using(bucket_id='label-originals' and exists(
    select 1 from public.label_files f
    where f.storage_path=storage.objects.name and f.kind='original' and f.scan_status='clean'
      and public.app_can_read_label_version(f.label_version_id)
  ));
drop policy vexim_normalized_read on storage.objects;
create policy vexim_normalized_read on storage.objects for select to authenticated
  using(bucket_id='label-normalized' and exists(
    select 1 from public.label_files f
    where f.storage_path=storage.objects.name and f.kind='normalized' and f.scan_status='clean'
      and public.app_can_read_label_version(f.label_version_id)
  ));
drop policy vexim_report_read on storage.objects;
create policy vexim_report_read on storage.objects for select to authenticated
  using(bucket_id='review-reports' and exists(
    select 1 from public.reports r
    where (r.pdf_path=storage.objects.name or r.json_path=storage.objects.name)
      and public.app_can_access_review(r.review_id)
  ));

create function public.vexim_current_label_bundle_sha256(lid uuid)
returns text language sql stable security definer set search_path=public,pg_temp as $$
  select case when count(*) > 0 and count(*) = count(*) filter(where scan_status='clean') then
    encode(extensions.digest(
      convert_to(jsonb_agg(jsonb_build_object('name',name,'sha256',sha256) order by name,sha256)::text, 'UTF8'),
      'sha256'
    ), 'hex')
  else null end
  from public.label_files
  where label_version_id = lid and kind = 'original'
$$;

create function public.vexim_invite_review_participant(
  rid uuid,
  participant_org uuid,
  requested_role public.review_party_role
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  r public.reviews;
  o public.organizations;
  p public.review_participants;
begin
  if requested_role not in ('commercial_importer','fsvp_importer') then
    raise exception 'Only importer parties can be invited';
  end if;
  select * into r from public.reviews where id=rid;
  if not found or not public.app_can_admin_org(r.organization_id) then
    raise exception 'Label-owner organization admin required' using errcode='42501';
  end if;
  if participant_org = r.organization_id then
    raise exception 'Importer must be a separate organization';
  end if;
  select * into o from public.organizations where id=participant_org and status='active';
  if not found then raise exception 'Importer organization unavailable'; end if;
  insert into public.review_participants(
    review_id, organization_id, organization_name_snapshot, party_role,
    status, invited_by
  ) values (
    rid, o.id, o.name, requested_role, 'invited', auth.uid()
  ) on conflict(review_id, organization_id, party_role) do update set
    organization_name_snapshot=excluded.organization_name_snapshot,
    status='invited', invited_by=excluded.invited_by, invited_at=now(),
    activated_by=null, activated_at=null,
    fsvp_attested_by=null, fsvp_attested_at=null, fsvp_attestation_note=null
  where public.review_participants.status='removed'
  returning * into p;
  if not found then raise exception 'Importer party is already invited or active'; end if;
  perform public.app_write_audit(
    r.organization_id, 'review.participant_invited', 'review', rid::text,
    'Invited a separate review party',
    jsonb_build_object('participant_id',p.id,'party_role',requested_role,'organization_name',o.name)
  );
  return to_jsonb(p);
end
$$;

create function public.vexim_accept_review_participant(
  participant_id uuid,
  attests_fsvp boolean default false,
  attestation_note text default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  p public.review_participants;
  r public.reviews;
begin
  select * into p from public.review_participants where id=participant_id for update;
  if not found or not public.app_can_admin_org(p.organization_id) then
    raise exception 'Importer organization admin required' using errcode='42501';
  end if;
  if p.status <> 'invited' then raise exception 'Invitation is not pending'; end if;
  if p.party_role = 'fsvp_importer' then
    if not coalesce(attests_fsvp,false) or length(trim(coalesce(attestation_note,''))) not between 10 and 5000 then
      raise exception 'Explicit FSVP capacity attestation and rationale are required';
    end if;
  elsif coalesce(attests_fsvp,false) or nullif(trim(attestation_note),'') is not null then
    raise exception 'Commercial participation cannot assert FSVP capacity';
  end if;
  update public.review_participants set
    status='active', activated_by=auth.uid(), activated_at=now(),
    fsvp_attested_by=case when p.party_role='fsvp_importer' then auth.uid() else null end,
    fsvp_attested_at=case when p.party_role='fsvp_importer' then now() else null end,
    fsvp_attestation_note=case when p.party_role='fsvp_importer' then trim(attestation_note) else null end
  where id=participant_id returning * into p;
  select * into r from public.reviews where id=p.review_id;
  perform public.app_write_audit(
    r.organization_id, 'review.participant_accepted', 'review', r.id::text,
    'Importer accepted review participation',
    jsonb_build_object('participant_id',p.id,'party_role',p.party_role,'organization_name',p.organization_name_snapshot,'fsvp_attested',p.party_role='fsvp_importer')
  );
  return to_jsonb(p);
end
$$;

create function public.vexim_remove_review_participant(
  participant_id uuid,
  reason text
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.review_participants; r public.reviews;
begin
  select * into p from public.review_participants where id=participant_id for update;
  if not found then raise exception 'Review participant unavailable' using errcode='42501'; end if;
  select * into r from public.reviews where id=p.review_id;
  if p.party_role='label_owner' or not public.app_can_admin_org(r.organization_id) then
    raise exception 'Only the label owner can remove an invited importer' using errcode='42501';
  end if;
  if length(trim(coalesce(reason,''))) not between 5 and 5000 then raise exception 'Reason required'; end if;
  if p.status='removed' then return; end if;
  update public.review_participants set status='removed' where id=participant_id;
  perform public.app_write_audit(r.organization_id,'review.participant_removed','review',r.id::text,
    trim(reason),jsonb_build_object('participant_id',p.id,'party_role',p.party_role,'organization_name',p.organization_name_snapshot));
end
$$;

create function public.vexim_share_review_with_importer(
  rid uuid,
  share_comment text
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.reviews; bundle_hash text;
begin
  select * into r from public.reviews where id=rid for update;
  if not found or not public.app_can_admin_org(r.organization_id) then
    raise exception 'Label-owner organization admin required' using errcode='42501';
  end if;
  if r.status not in ('AI_REVIEW_READY','HUMAN_REVIEW','REVISION_REQUIRED') then
    raise exception 'Analysis must be ready for business review before sharing';
  end if;
  if r.collaboration_status <> 'not_shared' then
    raise exception 'This review has already been shared; create a new label version for another review cycle';
  end if;
  if length(trim(coalesce(share_comment,''))) not between 5 and 5000 then raise exception 'Sharing rationale required'; end if;
  if not exists(select 1 from public.review_participants p where p.review_id=rid and p.party_role='commercial_importer' and p.status='active') then
    raise exception 'An accepted commercial importer participant is required';
  end if;
  bundle_hash:=public.vexim_current_label_bundle_sha256(r.label_version_id);
  if bundle_hash is null then raise exception 'Every original label file must pass malware scanning before sharing'; end if;
  if not exists(
    select 1 from public.review_party_decisions d
    join public.review_participants p on p.id=d.participant_id
    where d.review_id=rid and d.label_version_id=r.label_version_id
      and p.party_role='label_owner' and p.organization_id=r.organization_id
      and d.decision='accepted' and d.label_bundle_sha256=bundle_hash
  ) then raise exception 'Label owner must review and accept this exact file version first'; end if;
  update public.reviews set collaboration_status='awaiting_importer',updated_at=now() where id=rid;
  perform public.app_write_audit(r.organization_id,'review.shared_with_importer','review',rid::text,
    trim(share_comment),jsonb_build_object('label_version_id',r.label_version_id,'label_bundle_sha256',bundle_hash));
end
$$;

create function public.vexim_record_party_decision(
  rid uuid,
  requested_role public.review_party_role,
  requested_decision public.review_party_decision,
  decision_comment text,
  proposed_changes jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  r public.reviews;
  p public.review_participants;
  bundle_hash text;
  actor_name text;
  decision_row public.review_party_decisions;
begin
  if requested_role not in ('label_owner','commercial_importer') then
    raise exception 'FSVP designation is separate from label-version approval';
  end if;
  if jsonb_typeof(coalesce(proposed_changes,'[]'::jsonb)) <> 'array'
     or octet_length(coalesce(proposed_changes,'[]'::jsonb)::text) > 20000 then
    raise exception 'Proposed changes must be a JSON array under 20 KB';
  end if;
  if length(trim(coalesce(decision_comment,''))) < 5 then raise exception 'A reasoned comment is required'; end if;
  if requested_decision='proposed_edit' and jsonb_array_length(coalesce(proposed_changes,'[]'::jsonb))=0 then
    raise exception 'At least one annotated proposed change is required';
  elsif requested_decision<>'proposed_edit' and jsonb_array_length(coalesce(proposed_changes,'[]'::jsonb))<>0 then
    raise exception 'Only proposed_edit may contain proposed changes';
  end if;
  if requested_decision='proposed_edit' and exists(
    select 1 from jsonb_array_elements(coalesce(proposed_changes,'[]'::jsonb)) item
    where jsonb_typeof(item)<>'object'
      or (item - 'field' - 'current_value' - 'proposed_value' - 'reason')<>'{}'::jsonb
      or jsonb_typeof(item->'field')<>'string'
      or coalesce(length(trim(item->>'field')),0) not between 1 and 200
      or (item ? 'current_value' and jsonb_typeof(item->'current_value')<>'string')
      or coalesce(length(item->>'current_value'),0)>5000
      or jsonb_typeof(item->'proposed_value')<>'string'
      or coalesce(length(trim(item->>'proposed_value')),0) not between 1 and 5000
      or jsonb_typeof(item->'reason')<>'string'
      or coalesce(length(trim(item->>'reason')),0) not between 5 and 2000
  ) then
    raise exception 'Proposed changes contain invalid fields or lengths';
  end if;
  select * into r from public.reviews where id=rid for update;
  if not found or r.status not in ('AI_REVIEW_READY','HUMAN_REVIEW','REVISION_REQUIRED') then
    raise exception 'Review is unavailable for party decisions';
  end if;
  select * into p from public.review_participants rp
  where rp.review_id=rid and rp.party_role=requested_role and rp.status='active'
    and exists(select 1 from public.organization_members m where m.organization_id=rp.organization_id and m.user_id=auth.uid() and m.status='active')
  for update;
  if not found then raise exception 'Active review participation required' using errcode='42501'; end if;
  if requested_role='label_owner' and p.organization_id<>r.organization_id then
    raise exception 'Label owner must be the review-owning organization' using errcode='42501';
  end if;
  if requested_decision='accepted' and not public.app_can_admin_org(p.organization_id) then
    raise exception 'Organization admin is required to accept a label version' using errcode='42501';
  end if;
  if requested_role='label_owner' and requested_decision<>'accepted' then
    raise exception 'Only the importer may request or propose label changes';
  end if;
  if requested_role='commercial_importer' then
    if r.collaboration_status not in ('awaiting_importer','changes_requested') then
      raise exception 'The label version has not been shared with the importer';
    end if;
    if requested_decision='accepted' and r.collaboration_status<>'awaiting_importer' then
      raise exception 'A requested change requires a new label version and review';
    end if;
  elsif r.collaboration_status<>'not_shared' then
    raise exception 'The owner sign-off is already closed for this review';
  end if;
  bundle_hash:=public.vexim_current_label_bundle_sha256(r.label_version_id);
  if bundle_hash is null then raise exception 'Every original label file must pass malware scanning before a party decision'; end if;
  if requested_role='commercial_importer' and requested_decision='accepted' and not exists(
    select 1 from public.review_party_decisions d
    join public.review_participants owner_party on owner_party.id=d.participant_id
    where d.review_id=rid and d.label_version_id=r.label_version_id
      and owner_party.party_role='label_owner' and owner_party.organization_id=r.organization_id
      and d.decision='accepted' and d.label_bundle_sha256=bundle_hash
  ) then raise exception 'Label owner has not accepted this exact version'; end if;
  select full_name into actor_name from public.profiles where id=auth.uid();
  insert into public.review_party_decisions(
    review_id,label_version_id,participant_id,party_role,decision,comment,
    proposed_changes,label_bundle_sha256,actor_id,actor_name_snapshot
  ) values (
    rid,r.label_version_id,p.id,requested_role,requested_decision,trim(decision_comment),
    coalesce(proposed_changes,'[]'::jsonb),bundle_hash,auth.uid(),coalesce(nullif(actor_name,''),'Organization member')
  ) returning * into decision_row;
  if requested_role='commercial_importer' then
    update public.reviews set collaboration_status=case
      when requested_decision='accepted' then 'mutually_accepted'::public.review_collaboration_status
      else 'changes_requested'::public.review_collaboration_status
    end, updated_at=now() where id=rid;
  end if;
  perform public.app_write_audit(r.organization_id,'review.party_decision_recorded','review',rid::text,
    'Party recorded a label-version decision',
    jsonb_build_object('decision_id',decision_row.id,'participant_id',p.id,'party_role',requested_role,
      'decision',requested_decision,'label_version_id',r.label_version_id,'label_bundle_sha256',bundle_hash));
  return to_jsonb(decision_row);
end
$$;

-- Full review-scoped citation access, without opening the global registry.
create or replace function public.vexim_customer_citations()
returns setof public.regulatory_sources language sql stable security definer set search_path=public,pg_temp as $$
  select distinct s.*
  from public.regulatory_sources s
  where public.app_is_active() and exists(
    select 1 from public.findings f
    where s.id=any(f.citation_ids) and public.app_can_access_review(f.review_id)
  )
$$;

create or replace function public.vexim_log_file_access(fid uuid, access_action text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare
  f public.label_files;
  bundled_demo_svg boolean;
begin
  select * into f from public.label_files where id=fid;
  if not found or not public.app_can_read_label_version(f.label_version_id) then
    raise exception 'File unavailable' using errcode='42501';
  end if;
  bundled_demo_svg := f.mime_type='image/svg+xml'
    and f.kind='original'
    and f.scan_status='dev_unscanned'
    and (
      (f.storage_path='demo-static/lotus-front-v2.svg' and f.size=3130
        and f.sha256='f59f85ab26e113c50d1524ea8ddb7ec78b380672bd7d921a115c5b9719793177')
      or
      (f.storage_path='demo-static/lotus-back-v2.svg' and f.size=2253
        and f.sha256='ae6821bb45d6bca1a3d241a9eab5947cba3b76d7b861c50da0199112f8f8fa02')
    );
  if f.scan_status<>'clean' and not bundled_demo_svg then
    raise exception 'File unavailable' using errcode='42501';
  end if;
  if access_action not in ('view','download','signed_url') then raise exception 'Invalid access action'; end if;
  if bundled_demo_svg and access_action='signed_url' then
    raise exception 'Bundled demo artwork is not stored in Supabase Storage' using errcode='42501';
  end if;
  perform public.app_write_audit(f.organization_id,'file.'||access_action,'label_version',f.label_version_id::text,
    access_action||' '||f.name,jsonb_build_object('file_id',fid));
end
$$;

create or replace function public.vexim_log_report_download(report_id uuid, format text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.reports;
begin
  select * into r from public.reports where id=report_id;
  if not found or not public.app_can_access_review(r.review_id) then raise exception 'Report unavailable' using errcode='42501'; end if;
  if format not in ('pdf','json') then raise exception 'Invalid format'; end if;
  perform public.app_write_audit(r.organization_id,'report.downloaded','report',r.id::text,
    'Downloaded '||r.report_number||' as '||format,'{}');
end
$$;

revoke all on public.review_participants,public.review_party_decisions from anon,authenticated;
grant select on public.review_participants,public.review_party_decisions to authenticated;
grant all on public.review_participants,public.review_party_decisions to service_role;
revoke execute on function public.app_can_access_review(uuid),public.app_can_read_product(uuid),public.app_can_read_label_version(uuid),public.vexim_current_label_bundle_sha256(uuid),public.app_add_review_owner_participant(),public.app_review_participant_identity_guard() from public,anon,authenticated;
grant execute on function public.app_can_access_review(uuid),public.app_can_read_product(uuid),public.app_can_read_label_version(uuid) to authenticated;
revoke execute on function public.vexim_invite_review_participant(uuid,uuid,public.review_party_role),public.vexim_accept_review_participant(uuid,boolean,text),public.vexim_remove_review_participant(uuid,text),public.vexim_share_review_with_importer(uuid,text),public.vexim_record_party_decision(uuid,public.review_party_role,public.review_party_decision,text,jsonb) from public,anon,authenticated;
grant execute on function public.vexim_invite_review_participant(uuid,uuid,public.review_party_role),public.vexim_accept_review_participant(uuid,boolean,text),public.vexim_remove_review_participant(uuid,text),public.vexim_share_review_with_importer(uuid,text),public.vexim_record_party_decision(uuid,public.review_party_role,public.review_party_decision,text,jsonb),public.vexim_customer_citations(),public.vexim_log_file_access(uuid,text),public.vexim_log_report_download(uuid,text) to authenticated;
grant execute on function public.app_can_access_review(uuid),public.app_can_read_product(uuid),public.app_can_read_label_version(uuid),public.vexim_current_label_bundle_sha256(uuid),public.vexim_invite_review_participant(uuid,uuid,public.review_party_role),public.vexim_accept_review_participant(uuid,boolean,text),public.vexim_remove_review_participant(uuid,text),public.vexim_share_review_with_importer(uuid,text),public.vexim_record_party_decision(uuid,public.review_party_role,public.review_party_decision,text,jsonb),public.app_add_review_owner_participant(),public.vexim_customer_citations(),public.vexim_log_file_access(uuid,text),public.vexim_log_report_download(uuid,text) to service_role;

commit;
