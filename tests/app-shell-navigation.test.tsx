import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...props }, children),
  useLinkStatus: () => ({ pending: false }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/cliente-demo",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { AppShell } from "@/components/app-shell";

describe("app shell navigation", () => {
  it("uses the buyer workspace as Inicio without a duplicate stock link", () => {
    const html = renderToStaticMarkup(
      <AppShell
        accounts={[{ id: "buyer", slug: "cliente-demo", legalName: "Cliente Demo", kind: "BUYER" }]}
        automaticPaymentsAvailable={false}
      >
        <main>Workspace</main>
      </AppShell>,
    );

    expect(html).toContain("<span>Inicio</span>");
    expect(html).toContain('href="/cliente-demo"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("<strong>Inicio</strong>");
    expect(html).not.toContain("Stock y pedidos");
  });
});
