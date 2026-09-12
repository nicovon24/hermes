export const ENTRY_DURATION_MS = 650;
export const PRESENTATION_DEADLINE_MS = 55_000;
export const CATCH_UP_AFTER_MS = 50_000;

/** Visual pacing never changes or creates a business event. */
export function presentationBatchSize(queued: number, elapsed: number, reducedMotion: boolean) {
  return reducedMotion || elapsed >= CATCH_UP_AFTER_MS ? queued : Math.min(1, queued);
}
export function presentationCadence(queued: number) { return queued > 8 ? 350 : 750; }
export function presentationIsBlocking(elapsed: number, complete: boolean) { return !complete && elapsed < PRESENTATION_DEADLINE_MS; }
