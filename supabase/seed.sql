-- Explicit, transactional, synthetic review-demo seed.
-- Prerequisite: migrations 0001-0007 and the 15-rule DRAFT pack/sources from 0002.
-- Apply only to the approved Supabase Staging project; this file is not auto-enabled.
-- It does not create Auth users, upload Storage objects, run OCR/triage, issue reports,
-- change rules/sources/snapshots/feature flags, or approve/activate anything.
begin;

create temporary table demo_srd_seed_actor on commit drop as
select (
  select p.id
  from public.profiles p
  where p.active and p.staff_role = 'reviewer'
  order by p.created_at, p.id
  limit 1
) as reviewer_id;

do $preflight$
declare
  required_rule_keys constant text[] := array[
    'IDENTITY-001', 'NETQTY-001', 'INGREDIENT-001', 'NUTRITION-001',
    'NUTRITION-002', 'ALLERGEN-001', 'ALLERGEN-002', 'CLAIM-001',
    'CLAIM-002', 'CLAIM-003', 'FORMULA-001', 'LABEL-001',
    'LABEL-002', 'PARTY-001', 'CLASS-001'
  ];
  rule_count integer;
begin
  if exists (
    select 1 from pg_temp.demo_srd_seed_actor where reviewer_id is null
  ) then
    raise exception 'Demo seed stopped: an existing active reviewer profile is required; no Auth user will be created.';
  end if;

  if not exists (
    select 1 from public.triage_feature_flags
    where singleton and pre_screening_enabled = false
  ) then
    raise exception 'Demo seed stopped: pre_screening_enabled must already be false. This seed never changes feature flags.';
  end if;

  select count(*) into rule_count
  from public.compliance_rules
  where rule_key = any(required_rule_keys);
  if rule_count <> 15 then
    raise exception 'Demo seed stopped: expected exactly the 15 existing tea rules; found %.', rule_count;
  end if;
  if exists (
    select 1 from public.compliance_rules
    where rule_key = any(required_rule_keys) and status <> 'DRAFT'
  ) then
    raise exception 'Demo seed stopped: every one of the 15 tea rules must remain DRAFT.';
  end if;
  if exists (
    select 1
    from public.compliance_rules r
    cross join lateral unnest(r.source_citations) citation(source_id)
    left join public.regulatory_sources s on s.id = citation.source_id
    where r.rule_key = any(required_rule_keys)
      and (s.id is null or s.status <> 'DRAFT')
  ) then
    raise exception 'Demo seed stopped: each cited source for the 15-rule pack must exist and remain DRAFT.';
  end if;

  -- Preserve this separately reviewed parser snapshot exactly as-is and outside ACTIVE/RAG.
  if exists (
    select 1 from public.regulatory_snapshots
    where id = '197c2171-c4e8-46c8-8456-4e70b1ccde14'
      and status <> 'DRAFT'
  ) then
    raise exception 'Demo seed stopped: parser snapshot 197c2171-c4e8-46c8-8456-4e70b1ccde14 is not DRAFT.';
  end if;
end
$preflight$;

-- An isolated synthetic organization. ON CONFLICT never overwrites existing data.
insert into public.organizations (
  id, name, country, contact_email, contact_name, status
) values (
  'a0000000-0000-4000-8000-000000000001',
  'An Nhiên Tea — DEMO',
  'VN',
  'demo@annhientea.example',
  'Synthetic demo fixture',
  'active'
)
on conflict (id) do nothing;

do $organization_guard$
begin
  if not exists (
    select 1 from public.organizations
    where id = 'a0000000-0000-4000-8000-000000000001'
      and name = 'An Nhiên Tea — DEMO'
      and country = 'VN'
      and contact_email = 'demo@annhientea.example'
      and contact_name = 'Synthetic demo fixture'
      and status = 'active'
  ) then
    raise exception 'Demo seed stopped: reserved demo organization ID is already used by different data.';
  end if;
end
$organization_guard$;

insert into public.products (
  id, organization_id, name, brand, category, form, market, channel,
  expected_us_units_12m, employee_fte, classification_status,
  package_size, net_quantity, manufacturer, packer, distributor, importer,
  claims, certifications, exemption_requested, formula_confirmed,
  claims_confirmed, assigned_to, created_by, color
)
select
  'd0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  'Trà sen túi lọc',
  'AN NHIÊN',
  'tea_bag',
  'tea_bag',
  'US',
  array['retail', 'amazon']::text[],
  10000,
  20,
  'conventional_food',
  '20 túi × 2 g',
  '1.41 oz (40 g)',
  '{"name":"An Nhiên Tea","address":"Hà Nội, Việt Nam (dữ liệu mẫu)"}'::jsonb,
  '{"name":"","address":""}'::jsonb,
  '{"name":"","address":""}'::jsonb,
  '{"name":"","address":""}'::jsonb,
  array['Naturally helps prevent diabetes']::text[],
  '{}'::text[],
  true,
  false,
  false,
  seed_actor.reviewer_id,
  seed_actor.reviewer_id,
  'sage'
from pg_temp.demo_srd_seed_actor seed_actor
on conflict (id) do nothing;

insert into public.formula_ingredients (
  id, product_id, organization_id, name_original, name_english,
  normalized_name, percentage, "order", allergen_groups, source
) values
  (
    'f0000000-0000-4000-8000-000000000001',
    'd0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001',
    'Trà xanh', 'Green tea leaves', 'green_tea_leaves', 96, 1, '{}', 'customer_input'
  ),
  (
    'f0000000-0000-4000-8000-000000000002',
    'd0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001',
    'Hoa sen', 'Lotus flower', 'lotus_flower', 4, 2, '{}', 'customer_input'
  )
on conflict do nothing;

do $product_guard$
begin
  if not exists (
    select 1 from public.products
    where id = 'd0000000-0000-4000-8000-000000000001'
      and organization_id = 'a0000000-0000-4000-8000-000000000001'
      and name = 'Trà sen túi lọc'
      and brand = 'AN NHIÊN'
      and category = 'tea_bag'
      and form = 'tea_bag'
      and market = 'US'
      and channel = array['retail', 'amazon']::text[]
      and package_size = '20 túi × 2 g'
      and net_quantity = '1.41 oz (40 g)'
      and claims = array['Naturally helps prevent diabetes']::text[]
      and exemption_requested
      and not formula_confirmed
      and not claims_confirmed
  ) then
    raise exception 'Demo seed stopped: reserved demo product ID is already used by different data.';
  end if;
  if (
    select count(*) from public.formula_ingredients
    where product_id = 'd0000000-0000-4000-8000-000000000001'
  ) <> 2 or not exists (
    select 1 from public.formula_ingredients
    where id = 'f0000000-0000-4000-8000-000000000001'
      and product_id = 'd0000000-0000-4000-8000-000000000001'
      and name_original = 'Trà xanh'
      and name_english = 'Green tea leaves'
      and percentage = 96 and "order" = 1
  ) or not exists (
    select 1 from public.formula_ingredients
    where id = 'f0000000-0000-4000-8000-000000000002'
      and product_id = 'd0000000-0000-4000-8000-000000000001'
      and name_original = 'Hoa sen'
      and name_english = 'Lotus flower'
      and percentage = 4 and "order" = 2
  ) then
    raise exception 'Demo seed stopped: the synthetic demo formula conflicts with existing data.';
  end if;
end
$product_guard$;

insert into public.label_versions (
  id, organization_id, product_id, version, status, uploaded_by
)
select
  '20000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000001',
  2,
  'under_review',
  seed_actor.reviewer_id
from pg_temp.demo_srd_seed_actor seed_actor
on conflict do nothing;

insert into public.label_files (
  id, label_version_id, organization_id, name, mime_type, size,
  storage_path, sha256, page_count, scan_status, kind
) values
  (
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001',
    'lotus-front-v2.svg',
    'image/svg+xml',
    3130,
    'demo-static/lotus-front-v2.svg',
    'f59f85ab26e113c50d1524ea8ddb7ec78b380672bd7d921a115c5b9719793177',
    1,
    'dev_unscanned',
    'original'
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001',
    'lotus-back-v2.svg',
    'image/svg+xml',
    2253,
    'demo-static/lotus-back-v2.svg',
    'ae6821bb45d6bca1a3d241a9eab5947cba3b76d7b861c50da0199112f8f8fa02',
    1,
    'dev_unscanned',
    'original'
  )
on conflict do nothing;

do $label_guard$
begin
  if not exists (
    select 1 from public.label_versions
    where id = '20000000-0000-4000-8000-000000000001'
      and organization_id = 'a0000000-0000-4000-8000-000000000001'
      and product_id = 'd0000000-0000-4000-8000-000000000001'
      and version = 2
      and status = 'under_review'
  ) then
    raise exception 'Demo seed stopped: reserved label-version ID is already used by different data.';
  end if;
  if (
    select count(*) from public.label_files
    where label_version_id = '20000000-0000-4000-8000-000000000001'
  ) <> 2 or not exists (
    select 1 from public.label_files
    where id = '10000000-0000-4000-8000-000000000001'
      and label_version_id = '20000000-0000-4000-8000-000000000001'
      and name = 'lotus-front-v2.svg'
      and mime_type = 'image/svg+xml'
      and size = 3130
      and storage_path = 'demo-static/lotus-front-v2.svg'
      and sha256 = 'f59f85ab26e113c50d1524ea8ddb7ec78b380672bd7d921a115c5b9719793177'
      and scan_status = 'dev_unscanned'
      and kind = 'original'
  ) or not exists (
    select 1 from public.label_files
    where id = '10000000-0000-4000-8000-000000000002'
      and label_version_id = '20000000-0000-4000-8000-000000000001'
      and name = 'lotus-back-v2.svg'
      and mime_type = 'image/svg+xml'
      and size = 2253
      and storage_path = 'demo-static/lotus-back-v2.svg'
      and sha256 = 'ae6821bb45d6bca1a3d241a9eab5947cba3b76d7b861c50da0199112f8f8fa02'
      and scan_status = 'dev_unscanned'
      and kind = 'original'
  ) then
    raise exception 'Demo seed stopped: the two synthetic SVG file rows conflict with existing data.';
  end if;
end
$label_guard$;

-- This dossier snapshot is explicitly synthetic. No extracted_fields rows are inserted:
-- the SVG is a review sample, not output from an OCR job.
insert into public.reviews (
  id, organization_id, product_id, label_version_id, review_scope,
  status, progress, assigned_to, requested_by, due_at, pipeline,
  idempotency_key, dossier_snapshot, rule_snapshot, missing_information,
  approved_by, approved_at, approval_comment
)
select
  '30000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'us_federal_food_labeling_mvp',
  'HUMAN_REVIEW',
  100,
  seed_actor.reviewer_id,
  seed_actor.reviewer_id,
  now() + interval '14 days',
  '[]'::jsonb,
  'SRD-ANHIEN-LOTUS-DEMO-001',
  (
    select to_jsonb(p) || jsonb_build_object(
      'formula', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', fi.id,
          'name_original', fi.name_original,
          'name_english', fi.name_english,
          'normalized_name', fi.normalized_name,
          'percentage', fi.percentage,
          'order', fi."order",
          'allergen_groups', fi.allergen_groups,
          'source', fi.source
        ) order by fi."order")
        from public.formula_ingredients fi
        where fi.product_id = p.id
      ), '[]'::jsonb),
      'demo_fixture', true,
      'demo_notice', 'Synthetic reviewer fixture. No OCR job, legal determination, rule activation, or report issuance was performed.'
    )
    from public.products p
    where p.id = 'd0000000-0000-4000-8000-000000000001'
  ),
  (
    select coalesce(jsonb_agg(jsonb_build_object(
      'rule_key', r.rule_key,
      'version', r.version,
      'source_versions', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', s.id,
          'version', s.version,
          'content_hash', s.content_hash
        ) order by s.id), '[]'::jsonb)
        from unnest(r.source_citations) citation(source_id)
        join public.regulatory_sources s on s.id = citation.source_id
      )
    ) order by r.rule_key), '[]'::jsonb)
    from public.compliance_rules r
    where r.rule_key = any(array[
      'IDENTITY-001', 'NETQTY-001', 'INGREDIENT-001', 'NUTRITION-001',
      'NUTRITION-002', 'ALLERGEN-001', 'ALLERGEN-002', 'CLAIM-001',
      'CLAIM-002', 'CLAIM-003', 'FORMULA-001', 'LABEL-001',
      'LABEL-002', 'PARTY-001', 'CLASS-001'
    ]::text[])
  ),
  array[
    'DEMO ONLY: synthetic fixture; no OCR job or legal determination was run.',
    'Independently review all 15 DRAFT tea rules and their DRAFT source metadata before recording any disposition.',
    'Confirm the formula, claims, artwork text, product classification, and any requested nutrition-labeling exemption with an expert.'
  ]::text[],
  null,
  null,
  null
from pg_temp.demo_srd_seed_actor seed_actor
on conflict (id) do nothing;

do $review_guard$
begin
  if not exists (
    select 1 from public.reviews
    where id = '30000000-0000-4000-8000-000000000001'
      and organization_id = 'a0000000-0000-4000-8000-000000000001'
      and product_id = 'd0000000-0000-4000-8000-000000000001'
      and label_version_id = '20000000-0000-4000-8000-000000000001'
      and idempotency_key = 'SRD-ANHIEN-LOTUS-DEMO-001'
      and status = 'HUMAN_REVIEW'
      and approved_by is null
      and approved_at is null
      and approval_comment is null
      and triage_evaluated_at is null
      and overall_result = 'NOT_ASSESSED'
      and report_status = 'NOT_ISSUED'
      and expert_review_status = 'PENDING'
      and jsonb_array_length(pipeline) = 0
      and dossier_snapshot->>'demo_fixture' = 'true'
  ) then
    raise exception 'Demo seed stopped: reserved review ID conflicts with an existing record or review-only state.';
  end if;
  if jsonb_array_length((
    select rule_snapshot from public.reviews
    where id = '30000000-0000-4000-8000-000000000001'
  )) <> 15 then
    raise exception 'Demo seed stopped: the review must snapshot exactly 15 DRAFT rule references.';
  end if;
end
$review_guard$;

with review_prompts(sequence_no, rule_key, task, artwork_side) as (
  values
    (1, 'IDENTITY-001', 'Independently check statement of identity placement and wording on the supplied artwork.', 'front'),
    (2, 'NETQTY-001', 'Independently check net-quantity wording, units, and placement on the supplied artwork.', 'front'),
    (3, 'INGREDIENT-001', 'Compare the ingredient statement on the artwork with the synthetic product formula.', 'back'),
    (4, 'NUTRITION-001', 'Review the nutrition-labeling presentation and determine whether supporting documentation is needed.', 'back'),
    (5, 'NUTRITION-002', 'Review the requested exemption against any nutrition-related claim and applicable DRAFT sources.', 'front'),
    (6, 'ALLERGEN-001', 'Check the full formula and artwork for major-allergen information; do not infer an allergen result from this prompt.', 'back'),
    (7, 'ALLERGEN-002', 'Independently verify sesame-related ingredients, controls, and any required declaration.', 'back'),
    (8, 'CLAIM-001', 'Classify any disease-treatment wording only after expert review of the artwork and current authoritative sources.', 'front'),
    (9, 'CLAIM-002', 'Check whether any nutrient-content claim is present and what substantiation would be required.', 'front'),
    (10, 'CLAIM-003', 'Review any natural, organic, or non-GMO representation and request substantiation if applicable.', 'front'),
    (11, 'FORMULA-001', 'Compare the customer-provided synthetic formula with the ingredient wording shown on the artwork.', 'back'),
    (12, 'LABEL-001', 'Inspect artwork legibility and identify any regions that require a clearer production file.', 'front'),
    (13, 'LABEL-002', 'Check required English-language information and bilingual layout independently.', 'back'),
    (14, 'PARTY-001', 'Verify responsible-party name, address, and role against confirmed business records.', 'back'),
    (15, 'CLASS-001', 'Confirm product classification and review scope with an expert before applying any rules.', 'front')
)
insert into public.findings (
  id, review_id, organization_id, rule_key, rule_version, severity, status,
  title, description, evidence, citation_ids, citation_pending,
  suggested_action, ai_confidence, reasoning_category,
  human_review_required, reviewer_comment, reviewed_by, reviewed_at
)
select
  ('40000000-0000-4000-8000-' || lpad(prompt.sequence_no::text, 12, '0'))::uuid,
  '30000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  rule.rule_key,
  rule.version,
  (rule.action_json->>'severity')::public.finding_severity,
  'open',
  '[DEMO · DRAFT] ' || rule.name,
  prompt.task || ' This is a synthetic expert-review prompt, not a legal finding. The rule and citations remain DRAFT; no OCR result or compliance conclusion is asserted.',
  jsonb_build_array(jsonb_build_object(
    'file_id', case prompt.artwork_side
      when 'front' then '10000000-0000-4000-8000-000000000001'
      else '10000000-0000-4000-8000-000000000002'
    end,
    'page', 1,
    'bbox', null,
    'text', '[DEMO FIXTURE] ' || prompt.task || ' No OCR was run; inspect the linked static sample artwork during independent review.',
    'kind', 'dossier'
  )),
  rule.source_citations,
  true,
  'DRAFT RULE PROMPT — not approved for use: ' || coalesce(rule.action_json->>'suggested_action', 'Independently review this item.'),
  null,
  coalesce(rule.condition_json->>'type', 'manual_review'),
  true,
  null,
  null,
  null
from review_prompts prompt
join public.compliance_rules rule
  on rule.rule_key = prompt.rule_key and rule.version = 1
on conflict (id) do nothing;

do $final_guard$
declare
  required_rule_keys constant text[] := array[
    'IDENTITY-001', 'NETQTY-001', 'INGREDIENT-001', 'NUTRITION-001',
    'NUTRITION-002', 'ALLERGEN-001', 'ALLERGEN-002', 'CLAIM-001',
    'CLAIM-002', 'CLAIM-003', 'FORMULA-001', 'LABEL-001',
    'LABEL-002', 'PARTY-001', 'CLASS-001'
  ];
begin
  if (
    select count(*) from public.findings
    where review_id = '30000000-0000-4000-8000-000000000001'
  ) <> 15 or (
    select count(distinct rule_key) from public.findings
    where review_id = '30000000-0000-4000-8000-000000000001'
  ) <> 15 or exists (
    select 1 from public.findings
    where review_id = '30000000-0000-4000-8000-000000000001'
      and (status <> 'open' or not citation_pending or not human_review_required
        or reviewer_comment is not null or reviewed_by is not null or reviewed_at is not null
        or ai_confidence is not null)
  ) or exists (
    select 1 from public.findings
    where review_id = '30000000-0000-4000-8000-000000000001'
      and not (rule_key = any(required_rule_keys))
  ) or exists (
    select 1 from unnest(required_rule_keys) required(rule_key)
    where not exists (
      select 1 from public.findings f
      where f.review_id = '30000000-0000-4000-8000-000000000001'
        and f.rule_key = required.rule_key
    )
  ) then
    raise exception 'Demo seed stopped: all 15 findings must be open, citation-pending, and review-only.';
  end if;

  if exists (
    select 1 from public.compliance_rules
    where rule_key = any(required_rule_keys) and status <> 'DRAFT'
  ) then
    raise exception 'Demo seed stopped: a tea rule changed state; no activation is allowed.';
  end if;
  if exists (
    select 1 from public.triage_feature_flags
    where singleton and pre_screening_enabled
  ) then
    raise exception 'Demo seed stopped: pre_screening_enabled changed; no feature flag is changed by this seed.';
  end if;
  if exists (
    select 1 from public.reports
    where review_id = '30000000-0000-4000-8000-000000000001'
  ) or exists (
    select 1 from public.pre_screening_reports
    where review_id = '30000000-0000-4000-8000-000000000001'
  ) or exists (
    select 1 from public.review_triage_runs
    where review_id = '30000000-0000-4000-8000-000000000001'
  ) or exists (
    select 1 from public.pipeline_jobs
    where review_id = '30000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'Demo seed stopped: no report, pre-screening artifact, triage run, or processing job is allowed.';
  end if;
  if exists (
    select 1 from public.regulatory_snapshots
    where id = '197c2171-c4e8-46c8-8456-4e70b1ccde14'
      and status <> 'DRAFT'
  ) then
    raise exception 'Demo seed stopped: parser snapshot 197c2171-c4e8-46c8-8456-4e70b1ccde14 must remain DRAFT.';
  end if;
end
$final_guard$;

commit;
