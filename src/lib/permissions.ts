import type { Actor, Role } from "./types";

export type Capability =
  | "products"
  | "review"
  | "regulatory"
  | "organizations"
  | "manage_organizations"
  | "members"
  | "audit"
  | "settings";
const permissions: Record<Capability, Role[]> = {
  products: [
    "customer_admin",
    "customer_contributor",
    "reviewer",
    "system_admin",
  ],
  review: ["reviewer"],
  regulatory: ["regulatory_admin"],
  organizations: ["customer_admin", "system_admin", "reviewer"],
  manage_organizations: ["customer_admin", "system_admin"],
  members: ["customer_admin", "system_admin"],
  audit: ["customer_admin", "reviewer", "regulatory_admin", "system_admin"],
  settings: [
    "customer_admin",
    "customer_contributor",
    "reviewer",
    "regulatory_admin",
    "system_admin",
  ],
};
export const can = (actor: Actor, capability: Capability) =>
  permissions[capability].includes(actor.role);
export function assertCan(actor: Actor, capability: Capability) {
  if (!can(actor, capability))
    throw new Error("Bạn không có quyền thực hiện thao tác này.");
}
export function canAccessOrg(actor: Actor, orgId: string) {
  return (
    ["reviewer", "system_admin"].includes(actor.role) ||
    actor.organization_id === orgId
  );
}
export function assertOrg(actor: Actor, orgId: string) {
  if (!canAccessOrg(actor, orgId))
    throw new Error("Bạn không có quyền truy cập tổ chức này.");
}
