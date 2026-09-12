"use client";

import { useActionState } from "react";

import { initialNegotiationActionState } from "@/modules/protocol/actions/action-state";
import { generateRecommendationAction } from "@/modules/protocol/actions/negotiations";

export function RecommendationButton({
  companyId,
  purchaseRequestId,
}: {
  companyId: string;
  purchaseRequestId: string;
}) {
  const actionWithContext = generateRecommendationAction.bind(
    null,
    companyId,
    purchaseRequestId,
  );
  const [state, action, pending] = useActionState(
    actionWithContext,
    initialNegotiationActionState,
  );

  return (
    <form action={action} className="stack">
      <button disabled={pending} type="submit">
        {pending ? "Comparando con Groq…" : "Generar recomendación"}
      </button>
      {state.message ? (
        <p className={`feedback ${state.ok ? "success" : "error"}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
