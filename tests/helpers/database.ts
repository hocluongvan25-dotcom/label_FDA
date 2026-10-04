import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { vector } from "@electric-sql/pglite-pgvector";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

export const ids = {
  admin: randomUUID(),
  reviewer: randomUUID(),
  regA: randomUUID(),
  regB: randomUUID(),
  customerA: randomUUID(),
  customerB: randomUUID(),
  contributor: randomUUID(),
  outsider: randomUUID(),
  orgA: randomUUID(),
  orgB: randomUUID(),
};
export async function createDatabase() {
  const db = new PGlite({ extensions: { pgcrypto, vector } });
  // Test-only Supabase schema shim. This is not a substitute for live Auth/Storage integration.
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz default now());
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claims',true)::jsonb->>'sub','')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claims',true)::jsonb->>'role' $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid);
    alter table storage.objects enable row level security;
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    grant execute on all functions in schema auth to anon,authenticated,service_role;
    grant select,insert,update,delete on storage.objects to authenticated,service_role;
    grant all on auth.users to service_role;
  `);
  for (const migration of [
    "0001_initial.sql",
    "0002_registry_seed.sql",
    "0003_regulatory_ingestion.sql",
    "0004_risk_based_triage.sql",
    "0005_fda_guidance_ingestion.sql",
    "0006_review_signoff_disposition.sql",
    "0007_demo_static_artwork.sql",
    "0008_collaborative_review_parties.sql",
    "0009_vexim_review_requests.sql",
  ])
    await db.exec(await readFile(`supabase/migrations/${migration}`, "utf8"));
  const people = [
    ["admin", "system_admin"],
    ["reviewer", "reviewer"],
    ["regA", "regulatory_admin"],
    ["regB", "regulatory_admin"],
    ["customerA", null],
    ["customerB", null],
    ["contributor", null],
    ["outsider", null],
  ] as const;
  for (const [person, role] of people) {
    await db.query(
      "insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3::jsonb)",
      [
        ids[person],
        `${person.toLowerCase()}@test.example`,
        JSON.stringify({ full_name: person, role: "system_admin" }),
      ],
    );
    if (role)
      await db.query(
        "update public.profiles set staff_role=$1::public.staff_role where id=$2",
        [role, ids[person]],
      );
  }
  await db.query(
    `insert into public.organizations(id,name,contact_email) values($1,'Tenant A','a@test.example'),($2,'Tenant B','b@test.example')`,
    [ids.orgA, ids.orgB],
  );
  for (const [user, org, role] of [
    [ids.customerA, ids.orgA, "customer_admin"],
    [ids.customerB, ids.orgB, "customer_admin"],
    [ids.contributor, ids.orgA, "customer_contributor"],
  ] as const)
    await db.query(
      `insert into public.organization_members(organization_id,user_id,role,status) values($1,$2,$3::public.member_role,'active')`,
      [org, user, role],
    );
  return db;
}
export async function actor(
  db: PGlite,
  user: string | null,
  role = "authenticated",
) {
  await db.exec("reset role");
  await db.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: user, role }),
  ]);
  await db.exec(`set role ${role}`);
}
export async function call<T = unknown>(
  db: PGlite,
  name: string,
  args: unknown[] = [],
) {
  await db.exec("savepoint rpc_call");
  try {
    const result = await db.query<{ result: T }>(
      `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as result`,
      args.map((a) =>
        typeof a === "object" && a !== null && !Array.isArray(a)
          ? JSON.stringify(a)
          : Array.isArray(a)
            ? JSON.stringify(a)
            : a,
      ),
    );
    await db.exec("release savepoint rpc_call");
    return result.rows[0]?.result;
  } catch (error) {
    await db.exec("rollback to savepoint rpc_call; release savepoint rpc_call");
    throw error;
  }
}
export function productDraft(org = ids.orgA) {
  return {
    organization_id: org,
    name: "Green tea",
    brand: "Test",
    category: "dry_packaged_tea",
    form: "loose_leaf",
    channel: ["retail"],
    expected_us_units_12m: 1000,
    employee_fte: 5,
    formula: [
      {
        name_original: "Trà xanh",
        name_english: "Green tea leaves",
        normalized_name: "green_tea",
        percentage: 100,
        allergen_groups: [],
      },
    ],
    claims: [],
    package_size: "40 g",
    net_quantity: "1.41 oz (40 g)",
    manufacturer: { name: "Tea Test Ltd", address: "1 Street, Hanoi, Vietnam" },
    packer: { name: "", address: "" },
    distributor: { name: "", address: "" },
    importer: { name: "", address: "" },
    certifications: [],
    exemption_requested: false,
    formula_confirmed: true,
    claims_confirmed: true,
  };
}
export async function submit(db: PGlite) {
  await actor(db, ids.customerA);
  const product = await call<{ id: string }>(db, "vexim_save_product", [
    productDraft(),
  ]);
  const label = await call<{
    id: string;
    original_files: { id: string; storage_path: string }[];
  }>(db, "vexim_create_label_version", [
    product.id,
    [
      {
        id: randomUUID(),
        name: "test.png",
        mime_type: "image/png",
        size: 100,
        sha256: "a".repeat(64),
        page_count: 1,
      },
    ],
  ]);
  for (const file of label.original_files)
    await db.query(
      "insert into storage.objects(bucket_id,name,owner) values('label-originals',$1,$2)",
      [file.storage_path, ids.customerA],
    );
  const review = await call<{ id: string; status: string }>(
    db,
    "vexim_submit_review",
    [label.id, `${label.id}:v1`],
  );
  return { product, label, review };
}
