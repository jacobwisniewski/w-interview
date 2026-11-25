export interface Clock {
  nowIso(): string;
  nowMs(): number;
}

export const systemClock: Clock = {
  nowIso: () => new Date().toISOString(),
  nowMs: () => Date.now(),
};
