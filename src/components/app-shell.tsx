"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CloseGlyph } from "./close-glyph";
import { HermesMark } from "./hermes-mark";
import { OnboardingTour } from "./onboarding-tour";
import { PurchaseFlowProvider } from "./purchase-flow-provider";

type Account = { id: string; slug: string; legalName: string; kind: string };
function NavigationPending() {
  const { pending } = useLinkStatus();
  return pending ? <span className="nav-pending" aria-label="Cargando página" /> : null;
}
function NavIcon({ kind }: { kind: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">{kind === "home" ? <path d="m3 10 9-7 9 7v10H3V10Zm6 10v-7h6v7" /> : kind === "context" ? <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M4 10h16M10 10v10" /></> : <path d="M4 4v16h16M8 16v-4m4 4V7m4 9v-6m4 6V4" />}</svg>;
}

export function AppShell({ accounts, automaticPaymentsAvailable, children }: { accounts: Account[]; automaticPaymentsAvailable: boolean; children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [automaticPayments, setAutomaticPayments] = useState(false);
  const [tourRequests, setTourRequests] = useState(0);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (menuOpen) closeButton.current?.focus(); }, [menuOpen]);
  const closeMenu = () => { setMenuOpen(false); document.getElementById("navigation-trigger")?.focus(); };
  const buyer = accounts.find((account) => account.kind === "BUYER");
  const current = accounts.find((account) => pathname === `/${account.slug}`) ?? buyer;
  const homePath = `/${buyer?.slug ?? "cliente-demo"}`;
  const links = [
    { href: homePath, label: "Inicio", icon: "home", tour: "inicio" },
    { href: "/protocol", label: "Negociaciones", icon: "analytics", tour: "negociaciones" },
    { href: "/context", label: "Contexto", icon: "context", tour: "contexto" },
  ];
  const activeLabel = links.find((link) => link.href === pathname)?.label
    ?? accounts.find((account) => pathname === `/${account.slug}`)?.legalName
    ?? "Tu espacio";
  const initials = (current?.legalName ?? "Hermes").split(" ").slice(0, 2).map((word) => word[0]).join("");
  const toggleTheme = () => {
    const theme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    document.cookie = `hermes-theme=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
  };
  const toggleAutomaticPayments = () => {
    if (!automaticPaymentsAvailable) return;
    setAutomaticPayments((current) => !current);
  };

  if (pathname === "/") return <>{children}</>;

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Ir al contenido</a>
    {menuOpen ? <button type="button" className="nav-backdrop" aria-label="Cerrar navegación" onClick={closeMenu} tabIndex={-1} /> : null}
    <aside id="app-navigation" className={`app-sidebar ${menuOpen ? "is-open" : ""}`} onKeyDown={(event) => {
      if (!menuOpen) return;
      if (event.key === "Escape") closeMenu();
      if (event.key === "Tab") {
        const links = [...event.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)')];
        const first = links[0], last = links.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <button ref={closeButton} type="button" className="icon-button mobile-nav-close" aria-label="Cerrar menú" onClick={closeMenu}><CloseGlyph /></button>
      <Link href={homePath} className="hermes-brand" aria-label="Hermes, inicio"><span className="brand-mark"><HermesMark /></span><span>hermes</span><span className="brand-period">®</span></Link>
      <p className="nav-caption">TU ESPACIO</p>
      <nav className="app-nav" aria-label="Navegación principal">{links.map((link) => <Link href={link.href} key={link.href} data-tour={link.tour} className={pathname === link.href ? "active" : ""} aria-current={pathname === link.href ? "page" : undefined} onClick={() => setMenuOpen(false)}><NavIcon kind={link.icon} /><span>{link.label}</span><NavigationPending /></Link>)}</nav>
      <div className="sidebar-accounts" data-tour="empresas"><p className="nav-caption">EMPRESAS</p>{accounts.map((account) => <Link key={account.id} href={`/${account.slug}`} onClick={() => setMenuOpen(false)} className={pathname === `/${account.slug}` ? "selected" : ""}><span className={`account-dot ${account.kind === "BUYER" ? "buyer" : `supplier-${account.slug === "distribuidora-norte" ? "cyan" : account.slug === "mayorista-andino" ? "amber" : "violet"}`}`} /><span>{account.legalName}</span><NavigationPending /></Link>)}</div>
      <div className="sidebar-foot"><HermesMark /><strong>Las mejores condiciones,<br />a una conversación.</strong><button type="button" className="tour-launch" onClick={() => { setMenuOpen(false); setTourRequests((value) => value + 1); }}><span aria-hidden="true">?</span>Ver tutorial</button><span>Entorno de demostración</span></div>
    </aside>
    <div className="app-main">
<header className="app-topbar"><button type="button" id="navigation-trigger" aria-controls="app-navigation" className="icon-button mobile-menu" aria-expanded={menuOpen} aria-label="Abrir navegación" onClick={() => setMenuOpen((value) => !value)}>☰</button><div className="breadcrumb">Tu espacio <span>/</span><strong>{activeLabel}</strong></div><div className="topbar-tools"><button className={`payment-toggle ${automaticPayments ? "is-active" : ""}`} data-tour="autopay" type="button" role="switch" aria-checked={automaticPayments} aria-label={automaticPaymentsAvailable ? `Auto pay ${automaticPayments ? "activado" : "desactivado"}` : "Auto pay no configurado"} disabled={!automaticPaymentsAvailable} onClick={toggleAutomaticPayments} title={automaticPaymentsAvailable ? "Activar o desactivar pagos automáticos" : "Configurá las variables privadas de pago para habilitarlo"}><span className="payment-toggle-symbol" aria-hidden="true">$</span><span>Auto pay</span><span className="payment-toggle-track" aria-hidden="true"><span /></span></button><button className="theme-toggle" type="button" onClick={toggleTheme} aria-label="Cambiar entre modo claro y oscuro"><svg className="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M20 15.2A8.5 8.5 0 0 1 8.8 4a8.5 8.5 0 1 0 11.2 11.2Z" /></svg><svg className="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="3.5" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></svg></button><div className="account-identity"><strong>{current?.legalName ?? "Hermes"}</strong><span>{current?.kind === "SUPPLIER" ? "PROVEEDOR" : "COMERCIO"}</span></div><span className="account-avatar">{initials}</span></div></header>
      <div id="main-content" className="app-content"><PurchaseFlowProvider automaticPayments={automaticPayments} paymentsAvailable={automaticPaymentsAvailable} stagePath={homePath}>{children}</PurchaseFlowProvider></div>
      <footer className="app-footer"><span>hermes</span><span>Tu negocio sigue. Nosotros conversamos.</span></footer>
    </div>
    <OnboardingTour homePath={homePath} requestCount={tourRequests} />
  </div>;
}
