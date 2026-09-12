import type { Metadata } from "next";
import { cookies } from "next/headers";
import Script from "next/script";
import { AppShell } from "@/components/app-shell";
import { DEMO_COMPANIES } from "@/lib/demo-workspace";
import { paymentEnvironmentAvailable } from "@/lib/env";

import "./globals.css";
import "./hermes.css";

export const metadata: Metadata = {
  title: "Hermes · Tu stock, en movimiento",
  description: "Tu inventario, tus proveedores y las mejores condiciones en un solo lugar.",
};

export const dynamic = "force-dynamic";
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const theme = (await cookies()).get("hermes-theme")?.value === "light" ? "light" : "dark";
  return (
    <html lang="es" data-theme={theme} suppressHydrationWarning>
      <body>
        {process.env.NODE_ENV === "development" ? (
          <Script id="clear-stale-development-worker" strategy="beforeInteractive">
            {`(() => {
              if (!("serviceWorker" in navigator)) return;
              const marker = "hermes-sw-cleanup-reloaded";
              Promise.all([
                navigator.serviceWorker.getRegistrations().then((items) => Promise.all(items.map((item) => item.unregister()))),
                "caches" in window ? caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))) : Promise.resolve(),
              ]).then(() => {
                if (navigator.serviceWorker.controller && sessionStorage.getItem(marker) !== "1") {
                  sessionStorage.setItem(marker, "1");
                  location.reload();
                } else if (!navigator.serviceWorker.controller) {
                  sessionStorage.removeItem(marker);
                }
              });
            })();`}
          </Script>
        ) : null}
        <AppShell accounts={[...DEMO_COMPANIES]} automaticPaymentsAvailable={paymentEnvironmentAvailable()}>{children}</AppShell>
      </body>
    </html>
  );
}
