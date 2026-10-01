import { existsSync } from "node:fs";
import { serviceClient } from "../src/server/context";
async function main() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(
      "npm run staff -- --email person@example.com --role reviewer|regulatory_admin|system_admin",
    );
    return;
  }
  const value = (name: string) => args[args.indexOf(name) + 1];
  const email = args.includes("--email") ? value("--email") : undefined;
  const role = args.includes("--role") ? value("--role") : undefined;
  if (
    !email ||
    !role ||
    !["reviewer", "regulatory_admin", "system_admin"].includes(role)
  )
    throw new Error(
      "Usage: npm run staff -- --email person@example.com --role reviewer|regulatory_admin|system_admin",
    );
  const db = serviceClient();
  const { data, error } = await db
    .from("profiles")
    .select("id,email")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  if (error || !data)
    throw new Error(
      "Profile not found. Create/confirm the Supabase Auth account first.",
    );
  const account = await db.auth.admin.getUserById(data.id);
  if (
    account.error ||
    !account.data.user?.email_confirmed_at ||
    account.data.user.email?.toLowerCase() !== email.toLowerCase()
  )
    throw new Error(
      "Confirm the exact Auth email before trusted staff provisioning.",
    );
  const update = await db
    .from("profiles")
    .update({ staff_role: role, active: true })
    .eq("id", data.id);
  if (update.error)
    throw new Error(
      "Staff provisioning failed. Check migrations and trusted server configuration.",
    );
  console.log("Provisioned trusted staff role:", role, "for profile", data.id);
  console.log(
    "No credentials were printed. Permission changes are recorded in the append-only audit log.",
  );
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Provisioning failed");
  process.exitCode = 1;
});
