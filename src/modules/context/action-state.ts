export type ContextActionState = {
  ok: boolean;
  message: string | null;
};

export const initialContextActionState: ContextActionState = {
  ok: false,
  message: null,
};
