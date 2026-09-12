"use client";

import { type ReactNode, useId, useRef } from "react";

export function ConversationModal({
  supplierName,
  productName,
  messageCount,
  finalOfferTotal,
  children,
}: {
  supplierName: string;
  productName: string;
  messageCount: number;
  finalOfferTotal?: string;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  function openDialog() {
    dialogRef.current?.showModal();
    requestAnimationFrame(() => {
      const scrollArea = scrollRef.current;
      if (scrollArea) scrollArea.scrollTop = scrollArea.scrollHeight;
    });
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  return (
    <>
      <button className="conversation-trigger" onClick={openDialog} type="button">
        Ver conversación completa
        <span>{messageCount} mensajes</span>
      </button>
      <dialog
        aria-labelledby={titleId}
        className="conversation-dialog"
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}
        ref={dialogRef}
      >
        <div className="conversation-modal-shell">
          <header className="context-modal-header conversation-modal-header">
            <div>
              <p className="eyebrow">Flujo completo de negociación</p>
              <h2 id={titleId}>{supplierName}</h2>
              <p>{productName} · conversación ordenada desde la licitación hasta el cierre.</p>
            </div>
            <div className="conversation-header-actions">
              <span className={finalOfferTotal ? "final-offer-chip" : "pending-offer-chip"}>
                {finalOfferTotal
                  ? `Oferta final · ${finalOfferTotal}`
                  : "Oferta final pendiente"}
              </span>
              <button
                aria-label="Cerrar conversación"
                autoFocus
                className="context-close secondary"
                onClick={closeDialog}
                type="button"
              >
                ×
              </button>
            </div>
          </header>
          <div
            aria-label={`Mensajes de la negociación con ${supplierName}`}
            className="conversation-modal-body"
            ref={scrollRef}
            tabIndex={0}
          >
            {children}
          </div>
        </div>
      </dialog>
    </>
  );
}
