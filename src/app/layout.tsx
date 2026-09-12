import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/prisma";

import "./globals.css";
import "./hermes.css";

export const metadata: Metadata = {
  title: "Hermes · Tu stock, en movimiento",
  description: "Tu inventario, tus proveedores y las mejores condiciones en un solo lugar.",
};

export const dynamic = "force-dynamic";
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const accounts = await prisma.company.findMany({ select: { id: true, slug: true, legalName: true, kind: true }, orderBy: [{ kind: "asc" }, { legalName: "asc" }] });
  const theme = (await cookies()).get("hermes-theme")?.value === "light" ? "light" : "dark";
  return (
    <html lang="es" data-theme={theme} suppressHydrationWarning>
      <body><AppShell accounts={accounts}>{children}</AppShell></body>
    </html>
  );
}
