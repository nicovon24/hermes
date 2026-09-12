import type { Metadata } from "next";
import Link from "next/link";
import styles from "./landing.module.css";

export const metadata: Metadata = {
  title: "Hermes · Protocolo de comunicación agéntica",
  description: "El protocolo para que agentes negocien, adjudiquen y paguen compras mayoristas.",
};

const features = [
  {
    number: "01",
    title: "Contexto que decide",
    copy: "Cada agente opera con inventario, capital objetivo en stock, márgenes esperados y condiciones comerciales reales.",
    color: "cyan",
  },
  {
    number: "02",
    title: "Negociación simultánea",
    copy: "Un agente comprador conversa con varios agentes vendedores a la vez y compara cada propuesta bajo los mismos criterios.",
    color: "amber",
  },
  {
    number: "03",
    title: "Ejecución agéntica",
    copy: "Una vez adjudicada la compra, Hermes puede ejecutar el pago con el saldo disponible en pesos y dentro de límites aprobados.",
    color: "violet",
  },
] as const;

function WingFlight() {
  return (
    <Link className={styles.wingFlight} href="#inicio" aria-label="Hermes, volver al inicio">
      <span className={styles.wingHalo} />
      <svg viewBox="0 0 120 102" role="img" aria-label="Ala de Hermes">
        <defs>
          <linearGradient id="wing-spectrum" x1="4" y1="96" x2="113" y2="7" gradientUnits="userSpaceOnUse">
            <stop stopColor="#75cedd" />
            <stop offset=".5" stopColor="#b5a3ee" />
            <stop offset="1" stopColor="#e5bd7c" />
          </linearGradient>
          <filter id="wing-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <g className={styles.wingDepth} fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path className={`${styles.wingLine} ${styles.wingCyan}`} pathLength="1" d="M9 87C21 43 54 21 114 9C87 33 60 57 9 87Z" />
          <path className={`${styles.wingLine} ${styles.wingViolet}`} pathLength="1" d="M12 90C42 69 66 53 102 39C87 69 54 87 12 90Z" />
          <path className={`${styles.wingLine} ${styles.wingAmber}`} pathLength="1" d="M15 96C48 87 69 78 87 72C72 93 48 102 15 96Z" />
          <path className={styles.wingFill} d="M9 87C21 43 54 21 114 9C87 33 60 57 9 87ZM12 90C42 69 66 53 102 39C87 69 54 87 12 90ZM15 96C48 87 69 78 87 72C72 93 48 102 15 96Z" />
        </g>
      </svg>
    </Link>
  );
}

function AgentNetwork() {
  const sellers = [
    { y: 62, color: "#75cedd", label: "Agente vendedor 01", delay: "0s" },
    { y: 142, color: "#e5bd7c", label: "Agente vendedor 02", delay: ".7s" },
    { y: 222, color: "#b5a3ee", label: "Agente vendedor 03", delay: "1.4s" },
  ];

  return (
    <div className={styles.networkFrame} aria-label="Tres agentes vendedores negociando en simultáneo con un agente comprador">
      <div className={styles.networkHeader}>
        <span><i /> Negociación en curso</span>
        <code>HMS-RFQ-042</code>
      </div>
      <svg className={styles.network} viewBox="0 0 760 286" role="img" aria-hidden="true">
        <defs>
          <linearGradient id="node-surface" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#28282d" />
            <stop offset="1" stopColor="#151518" />
          </linearGradient>
          <radialGradient id="buyer-halo">
            <stop stopColor="#ffffff" stopOpacity=".11" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx="154" cy="142" rx="140" ry="130" fill="url(#buyer-halo)" />
        <g className={styles.buyerNode}>
          <rect x="54" y="105" width="220" height="74" rx="18" fill="url(#node-surface)" stroke="#55555e" />
          <text x="164" y="135" textAnchor="middle" fill="#f2f2f4" fontSize="16">Agente comprador</text>
          <text x="164" y="157" textAnchor="middle" fill="#93939d" fontSize="11">Contexto de empresa activo</text>
        </g>
        <path d="M274 142h28" stroke="#55555e" />
        <circle cx="302" cy="142" r="4" fill="#f2f2f4" />
        {sellers.map((seller, index) => {
          const path = `M302 142 C420 142 438 ${seller.y} 548 ${seller.y}`;
          return (
            <g key={seller.label} className={styles.networkBranch} style={{ "--branch-color": seller.color, "--branch-delay": seller.delay } as React.CSSProperties}>
              <path d={path} pathLength="1" className={styles.routeBase} />
              <path d={path} pathLength="1" className={styles.routeActive} />
              <circle r="5" fill={seller.color} className={styles.packet}>
                <animateMotion dur={`${2.5 + index * .25}s`} begin={seller.delay} repeatCount="indefinite" path={path} />
              </circle>
              <line x1="548" y1={seller.y} x2="570" y2={seller.y} stroke={seller.color} strokeOpacity=".72" />
              <rect x="570" y={seller.y - 25} width="164" height="50" rx="12" fill="url(#node-surface)" stroke={seller.color} strokeOpacity=".7" />
              <circle cx="588" cy={seller.y} r="3.5" fill={seller.color} />
              <text x="601" y={seller.y - 2} fill="#f2f2f4" fontSize="11.5">{seller.label}</text>
              <text x="601" y={seller.y + 13} fill="#93939d" fontSize="9.5">Propuesta recibida</text>
            </g>
          );
        })}
      </svg>
      <div className={styles.networkFooter}>
        <span>3 conversaciones</span>
        <span>12 variables comparadas</span>
        <strong>Mejor oferta identificada</strong>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <main className={styles.landing} id="inicio">
      <WingFlight />
      <header className={styles.navbar}>
        <Link className={styles.wordmark} href="#inicio">hermes<sup>®</sup></Link>
        <span className={styles.logoDock} aria-hidden="true" />
        <div className={styles.navActions}>
          <nav aria-label="Navegación de la landing">
            <Link href="#protocolo">Protocolo</Link>
            <Link href="#vision">Visión</Link>
          </nav>
          <Link className={styles.navCta} href="/cliente-demo">Abrir demo <span aria-hidden="true">↗</span></Link>
        </div>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroAmbient} aria-hidden="true" />
        <div className={styles.heroCopy}>
          <p className={styles.kicker}><span /> Infraestructura para comercio B2B</p>
          <h1>Protocolo de comunicación <em>agéntica</em> para ventas mayoristas.</h1>
          <p className={styles.heroLead}>Hermes permite que agentes con contexto completo negocien compras en paralelo, adjudiquen la mejor propuesta y ejecuten el pago bajo límites aprobados.</p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryCta} href="/cliente-demo">Ver Hermes en acción <span aria-hidden="true">→</span></Link>
            <Link className={styles.textCta} href="#protocolo">Conocer el protocolo <span aria-hidden="true">↓</span></Link>
          </div>
        </div>
        <div className={styles.heroVisual}>
          <AgentNetwork />
        </div>
        <div className={styles.heroFoot}>
          <span>Contexto</span><i />
          <span>Negociación</span><i />
          <span>Adjudicación</span><i />
          <span>Pago</span>
        </div>
      </section>

      <section className={styles.protocol} id="protocolo">
        <div className={styles.sectionIntro}>
          <p className={styles.sectionLabel}>El protocolo</p>
          <h2>Una conversación comercial completa, de punta a punta.</h2>
          <p>Desarrollamos Hermes para que cada agente pueda representar fielmente a su empresa y convertir una intención de compra en una operación resuelta.</p>
        </div>
        <div className={styles.featureGrid}>
          {features.map((feature) => (
            <article className={`${styles.glassCard} ${styles[feature.color]}`} key={feature.number}>
              <span className={styles.cardNumber}>{feature.number}</span>
              <div className={styles.cardGlyph} aria-hidden="true">
                {feature.number === "01" ? <><span /><span /><span /></> : feature.number === "02" ? <><i /><b /><i /></> : <><strong>$</strong><span /></>}
              </div>
              <h3>{feature.title}</h3>
              <p>{feature.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.flowSection} aria-labelledby="flow-title">
        <div className={styles.flowCopy}>
          <p className={styles.sectionLabel}>Una misma capa de coordinación</p>
          <h2 id="flow-title">De la necesidad de stock al pago, sin perder el contexto.</h2>
        </div>
        <ol className={styles.flowList}>
          <li><span>01</span><strong>El agente interpreta la necesidad</strong><p>Lee inventario, objetivos de capital y reglas comerciales antes de salir al mercado.</p></li>
          <li><span>02</span><strong>Los vendedores compiten en paralelo</strong><p>Cada conversación mejora precio, cobertura, entrega y condiciones de forma simultánea.</p></li>
          <li><span>03</span><strong>Hermes adjudica dentro de los límites</strong><p>Compara propuestas completas y elige la combinación óptima sin exceder lo autorizado.</p></li>
          <li><span>04</span><strong>La operación se liquida en pesos</strong><p>El pago se ejecuta de forma agéntica con el saldo disponible y queda trazabilidad del proceso.</p></li>
        </ol>
      </section>

      <section className={styles.vision} id="vision">
        <div className={styles.visionGlow} aria-hidden="true" />
        <p className={styles.sectionLabel}>Nuestra visión</p>
        <blockquote>En un mundo donde cada empresa tendrá sus propios agentes, Hermes será el protocolo sobre el que ocurra el comercio B2B.</blockquote>
        <div className={styles.visionBottom}>
          <p>Agentes que entienden a quién representan. Conversaciones que respetan las reglas del negocio. Operaciones que pueden completarse de forma autónoma.</p>
          <Link className={styles.primaryCta} href="/cliente-demo">Explorar el protocolo <span aria-hidden="true">→</span></Link>
        </div>
      </section>

      <footer className={styles.footer}>
        <span className={styles.footerBrand}>hermes<sup>®</sup></span>
        <span>Protocolo de comercio agéntico</span>
        <span>Argentina · 2026</span>
      </footer>
    </main>
  );
}
