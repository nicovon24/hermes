"use client";

import { type ReactNode, useId, useRef } from "react";

import { CloseGlyph } from "./close-glyph";

export function ConversationModal({
  supplierName,
  productName,
  messageCount,
  finalOfferTotal,
  offerStatus,
  variant = "card",
  triggerLabel = "Ver conversación completa",
  children,
}: {
  supplierName: string;
  productName: string;
  messageCount: number;
  finalOfferTotal?: string;
  /** Overrides the header chip when the round ended without an offer to quote. */
  offerStatus?: { label: string; tone: "final" | "pending" | "empty" };
  /** `inline` renders a quiet text trigger for dense layouts such as tables. */
  variant?: "card" | "inline";
  triggerLabel?: string;
  children: ReactNode;
}) {
  const status = offerStatus ?? (finalOfferTotal
    ? { label: `Oferta final ${finalOfferTotal}`, tone: "final" as const }
    : { label: "Oferta final pendiente", tone: "pending" as const });
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
      {variant === "inline" ? (
        <button aria-label={`Ver la conversación con ${supplierName}, ${messageCount} mensajes`} className="conversation-link" onClick={openDialog} type="button">
          {messageCount} {messageCount === 1 ? "mensaje" : "mensajes"} <span aria-hidden="true">↗</span>
        </button>
      ) : (
        <button className="conversation-trigger" onClick={openDialog} type="button">
          {triggerLabel}
          <span>{messageCount} {messageCount === 1 ? "mensaje" : "mensajes"}</span>
        </button>
      )}
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
              <h2 id={titleId}>{supplierName}</h2>
              <p>{productName}</p>
            </div>
            <div className="conversation-header-actions">
              <span className={`${status.tone}-offer-chip`}>{status.label}</span>
              <button
                aria-label="Cerrar conversación"
                autoFocus
                className="context-close secondary"
                onClick={closeDialog}
                type="button"
              >
                <CloseGlyph />
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
