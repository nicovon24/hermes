export type PurchaseActionState = {
  ok: boolean;
  message: string | null;
  fieldErrors?: Record<string, string[]>;
};

export const initialPurchaseActionState: PurchaseActionState = {
  ok: false,
  message: null,
};

export type NegotiationActionState = {
  ok: boolean;
  message: string | null;
  data?: unknown;
};

export const initialNegotiationActionState: NegotiationActionState = {
  ok: false,
  message: null,
};
