-- A narrowly scoped exception for the two bundled, synthetic review-demo SVGs.
-- These are served from this application's public assets, never from Supabase Storage.
-- Ordinary upload validation and the signed-URL route continue to reject SVG/unscanned files.
begin;

alter table public.label_files
  drop constraint if exists label_files_mime_type_check;

alter table public.label_files
  add constraint label_files_mime_type_check check (
    mime_type in ('application/pdf', 'image/png', 'image/jpeg', 'image/tiff')
    or (
      mime_type = 'image/svg+xml'
      and kind = 'original'
      and scan_status = 'dev_unscanned'
      and (
        (
          storage_path = 'demo-static/lotus-front-v2.svg'
          and size = 3130
          and sha256 = 'f59f85ab26e113c50d1524ea8ddb7ec78b380672bd7d921a115c5b9719793177'
        )
        or
        (
          storage_path = 'demo-static/lotus-back-v2.svg'
          and size = 2253
          and sha256 = 'ae6821bb45d6bca1a3d241a9eab5947cba3b76d7b861c50da0199112f8f8fa02'
        )
      )
    )
  );

create or replace function public.vexim_log_file_access(
  fid uuid,
  access_action text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  f public.label_files;
  bundled_demo_svg boolean;
begin
  select * into f from public.label_files where id = fid;
  if not found then
    raise exception 'File unavailable' using errcode = '42501';
  end if;
  if not public.app_can_read_org(f.organization_id) then
    raise exception 'File unavailable' using errcode = '42501';
  end if;

  bundled_demo_svg :=
    f.mime_type = 'image/svg+xml'
    and f.kind = 'original'
    and f.scan_status = 'dev_unscanned'
    and (
      (
        f.storage_path = 'demo-static/lotus-front-v2.svg'
        and f.size = 3130
        and f.sha256 = 'f59f85ab26e113c50d1524ea8ddb7ec78b380672bd7d921a115c5b9719793177'
      )
      or
      (
        f.storage_path = 'demo-static/lotus-back-v2.svg'
        and f.size = 2253
        and f.sha256 = 'ae6821bb45d6bca1a3d241a9eab5947cba3b76d7b861c50da0199112f8f8fa02'
      )
    );

  if f.scan_status <> 'clean' and not bundled_demo_svg then
    raise exception 'File unavailable' using errcode = '42501';
  end if;
  if access_action not in ('view', 'download', 'signed_url') then
    raise exception 'Invalid access action';
  end if;
  if bundled_demo_svg and access_action = 'signed_url' then
    raise exception 'Bundled demo artwork is not stored in Supabase Storage' using errcode = '42501';
  end if;

  perform public.app_write_audit(
    f.organization_id,
    'file.' || access_action,
    'label_version',
    f.label_version_id::text,
    access_action || ' ' || f.name,
    jsonb_build_object('file_id', fid)
  );
end
$$;

revoke all on function public.vexim_log_file_access(uuid, text) from public, anon, authenticated;
grant execute on function public.vexim_log_file_access(uuid, text) to authenticated, service_role;

-- The sample is already placed in HUMAN_REVIEW with hand-authored review prompts.
-- Prevent a normal retry RPC from rewriting it or running unscanned static artwork through OCR/rules.
create or replace function public.vexim_retry_review(rid uuid, stage text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.reviews;
  j public.pipeline_jobs;
begin
  r := public.app_editable_review(rid);
  if rid = '30000000-0000-4000-8000-000000000001'
     and r.idempotency_key = 'SRD-ANHIEN-LOTUS-DEMO-001' then
    raise exception 'Synthetic demo review is view-only; pipeline reruns are disabled'
      using errcode = '42501';
  end if;
  if stage not in ('validation', 'ocr', 'extraction', 'rules', 'verification') then
    raise exception 'Invalid stage';
  end if;

  select * into j from public.pipeline_jobs where review_id = rid for update;
  if j.status = 'running' and j.locked_until > now() then
    raise exception 'Worker is already running this review';
  end if;
  update public.pipeline_jobs
  set status = 'queued', from_stage = stage, current_stage = stage,
      attempts = 0, next_run_at = now(), locked_by = null, locked_until = null,
      last_error = null, updated_at = now()
  where review_id = rid;
  update public.reviews
  set status = 'PROCESSING', error_message = null, rule_snapshot = '[]', updated_at = now(),
      pipeline = (
        select jsonb_agg(case
          when (s->>'stage') in (
            select x from unnest(array['validation','ocr','extraction','rules','verification'])
              with ordinality a(x,n)
            where n >= array_position(array['validation','ocr','extraction','rules','verification'], stage)
          ) then jsonb_set(s, '{status}', '"pending"')
          else s
        end)
        from jsonb_array_elements(r.pipeline) s
      )
  where id = rid;
  perform public.app_write_audit(
    r.organization_id,
    'review.retried',
    'review',
    rid::text,
    'Retry from ' || stage,
    jsonb_build_object('stage', stage)
  );
end
$$;

commit;
