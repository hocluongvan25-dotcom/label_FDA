import type { Metadata, Viewport } from "next";
import { AppProvider } from "@/components/app-provider";
import { AppShell } from "@/components/shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vexim Label Review — Rà soát nhãn thực phẩm",
  description:
    "Không gian hỗ trợ chuyên gia rà soát nhãn trà khô và trà túi lọc xuất khẩu sang Hoa Kỳ. Evidence, rule, citation và human review.",
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.svg" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#153b32",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>
        <AppProvider>
          <AppShell>{children}</AppShell>
        </AppProvider>
      </body>
    </html>
  );
}
