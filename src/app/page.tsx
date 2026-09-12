import Link from "next/link";

import { prisma } from "@/lib/prisma";
import { getCurrentWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { company } = await getCurrentWorkspace();
  const accounts = await prisma.company.findMany({
    select: { id: true, slug: true, legalName: true, kind: true },
    orderBy: [{ kind: "asc" }, { legalName: "asc" }],
  });

  return (
    <main className="shell narrow">
      <header className="topbar">
        <div>
          <p className="eyebrow">Cliente activo · demo sin login</p>
          <h1>{company.legal_name}</h1>
        </div>
      </header>
      <section className="hero-copy">
        <p className="eyebrow">Tu negocio, conectado</p>
        <h2>Menos gestión.<br />Más negocio.</h2>
        <p className="muted">Tu inventario marca el ritmo. Hermes conecta tus pedidos con tres proveedores para encontrar las mejores condiciones, producto por producto.</p>
        <Link className="primary-link" href="/cliente-demo">Ir a mi stock <span aria-hidden="true">↗</span></Link>
      </section>
      <div className="module-grid">
        <Link className="module-card" href="/context">
          <span className="status">CONTEXTO</span>
          <h3>ERP, stock y ventas</h3>
          <p>Fuentes, versiones, productos, inventario y señales para decidir qué comprar.</p>
        </Link>
        <Link className="module-card" href="/protocol">
          <span className="status">PROTOCOLO</span>
          <h3>Solicitudes y negociación</h3>
          <p>Mandatos, proveedores, mensajes, ofertas, políticas y recomendaciones de Groq.</p>
        </Link>
      </div>
      <section className="section-block account-section">
        <p className="eyebrow">Una red, distintas perspectivas</p>
        <h2>Las empresas de tu demo</h2>
        <div className="account-grid">
          {accounts.map((account) => (
            <Link className="account-card" href={`/${account.slug}`} key={account.id}>
              <span className="status">{account.kind === "BUYER" ? "CLIENTE" : "DISTRIBUIDOR"}</span>
              <h3>{account.legalName}</h3>
              <code>/{account.slug}</code>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
