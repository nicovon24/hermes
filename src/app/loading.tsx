export default function Loading() {
  return (
    <main className="route-loading" aria-live="polite" aria-busy="true">
      <div>
        <span className="route-loading-spinner" aria-hidden="true" />
        <span>Cargando tu espacio…</span>
      </div>
    </main>
  );
}
