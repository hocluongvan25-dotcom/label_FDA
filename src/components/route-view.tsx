"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { Dashboard } from "./dashboard";
import { ProductsPage, ReportsPage, ReviewsPage } from "./collection-pages";
import { ProductIntake } from "./product-intake";
import { ProductDetail } from "./product-detail";
import { ReviewWorkspace } from "./review-workspace";
import { AuditPage, CustomersPage } from "./admin-pages";
import { SourcesPage, RulesPage } from "./regulatory-pages";
import { KnowledgePage } from "./knowledge-page";
import { SettingsPage } from "./settings-page";
import { Card, EmptyState } from "./ui";

export function RouteView() {
  const path = usePathname();
  let screen;
  if (path === "/") screen = <Dashboard />;
  else if (path === "/products") screen = <ProductsPage />;
  else if (path === "/products/new")
    screen = <ProductIntake key="new-product" />;
  else if (/^\/products\/[^/]+\/edit$/.test(path))
    screen = <ProductIntake productId={path.split("/")[2]} key={path} />;
  else if (/^\/products\/[^/]+$/.test(path))
    screen = <ProductDetail productId={path.split("/")[2]} key={path} />;
  else if (path === "/reviews") screen = <ReviewsPage />;
  else if (/^\/reviews\/[^/]+$/.test(path))
    screen = <ReviewWorkspace reviewId={path.split("/")[2]} key={path} />;
  else if (path === "/reports") screen = <ReportsPage />;
  else if (path === "/customers") screen = <CustomersPage />;
  else if (path === "/sources") screen = <SourcesPage />;
  else if (path === "/knowledge") screen = <KnowledgePage />;
  else if (path === "/rules") screen = <RulesPage />;
  else if (path === "/audit") screen = <AuditPage />;
  else if (path === "/settings") screen = <SettingsPage />;
  else
    screen = (
      <Card>
        <EmptyState
          title="Trang này không tồn tại"
          description="Chọn một trang trong menu để tiếp tục làm việc."
          action={
            <Link href="/" className="btn btn-primary">
              Về tổng quan
            </Link>
          }
        />
      </Card>
    );
  return (
    <Suspense fallback={<div className="viewer-loading">Đang tải trang…</div>}>
      {screen}
    </Suspense>
  );
}
