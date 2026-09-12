"use client";

import { useId, useRef } from "react";

import { CloseGlyph } from "./close-glyph";

export type ContextMetric = {
  label: string;
  value: string;
};

export type ContextSection = {
  title: string;
  description?: string;
  metrics: ContextMetric[];
};

export type ContextSnapshot = {
  label: string;
  data: unknown;
};

export function ContextModal({
  triggerLabel,
  eyebrow,
  title,
  subtitle,
  sections,
  snapshots,
}: {
  triggerLabel: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  sections: ContextSection[];
  snapshots: ContextSnapshot[];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  function openDialog() {
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  return (
    <>
      <button className="context-trigger secondary" onClick={openDialog} type="button">
        {triggerLabel}
      </button>
      <dialog
        aria-labelledby={titleId}
        className="context-dialog"
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}
        ref={dialogRef}
      >
        <div className="context-modal-shell">
          <header className="context-modal-header">
            <div>
              <p className="eyebrow">{eyebrow}</p>
              <h2 id={titleId}>{title}</h2>
              <p>{subtitle}</p>
            </div>
            <button
              aria-label="Cerrar contexto"
              autoFocus
              className="context-close secondary"
              onClick={closeDialog}
              type="button"
            >
              <CloseGlyph />
            </button>
          </header>

          <div className="context-modal-body">
            {sections.map((section) => (
              <section className="context-section" key={section.title}>
                <div className="context-section-heading">
                  <h3>{section.title}</h3>
                  {section.description ? <p>{section.description}</p> : null}
                </div>
                <div className="context-metric-grid">
                  {section.metrics.map((metric) => (
                    <div key={`${section.title}-${metric.label}`}>
                      <span>{metric.label}</span>
                      <strong>{metric.value}</strong>
                    </div>
                  ))}
                </div>
              </section>
            ))}

            <section className="context-section">
              <div className="context-section-heading">
                <h3>Datos exactos del agente</h3>
                <p>
                  Entradas estructuradas utilizadas o preparadas por el servidor.
                </p>
              </div>
              <div className="context-snapshots">
                {snapshots.map((snapshot, index) => (
                  <details key={`${snapshot.label}-${index}`}>
                    <summary>{snapshot.label}</summary>
                    <pre>{JSON.stringify(snapshot.data, null, 2)}</pre>
                  </details>
                ))}
              </div>
            </section>
          </div>
        </div>
      </dialog>
    </>
  );
}
