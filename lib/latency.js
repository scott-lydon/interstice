// The latency module (5.1). It surfaces a fact Interstice already knows: when a prompt was
// submitted and when the agent's response arrived. It is driven purely by the existing engine
// events (a submit and a completion, each carrying a sessionId and an ISO timestamp), NOT by
// re-parsing transcripts, which would be a second source of truth for the same fact.
//
// Surface-agnostic (5.5): a Cowork-shaped event and a Claude-Code-shaped event are the same shape
// here, `{ sessionId, at }`, so both drive identical behaviour. Per-session (5.6): two prompts in
// flight are two independent timers, cleared independently.

export function createLatency() {
  /** sessionId -> submittedAt (ISO). Present only while a prompt is in flight. */
  const inFlight = new Map();

  return {
    /** A prompt was submitted. Starts (or restarts) that session's timer. */
    onSubmit({ sessionId, at }) {
      inFlight.set(sessionId, at);
    },

    /**
     * The response arrived. Clears that session's timer and returns a delivery record for the
     * arrival notification, or null if there was no timer for it (a completion with no submit).
     * @returns {{ sessionId:string, submittedAt:string, arrivedAt:string, elapsedMs:number } | null}
     */
    onComplete({ sessionId, at }) {
      const submittedAt = inFlight.get(sessionId);
      if (submittedAt === undefined) return null;
      inFlight.delete(sessionId);
      return { sessionId, submittedAt, arrivedAt: at, elapsedMs: Date.parse(at) - Date.parse(submittedAt) };
    },

    /** Elapsed ms since submit for a session, or null when it is not in flight. */
    elapsedMs(sessionId, nowISO) {
      const submittedAt = inFlight.get(sessionId);
      if (submittedAt === undefined) return null;
      return Date.parse(nowISO) - Date.parse(submittedAt);
    },

    /** Whether a session is currently waiting on a response. */
    isWaiting(sessionId) {
      return inFlight.has(sessionId);
    },

    /** All in-flight sessions as plain data, for the panel to render. */
    active(nowISO) {
      return [...inFlight.entries()].map(([sessionId, submittedAt]) => ({
        sessionId,
        submittedAt,
        elapsedMs: Date.parse(nowISO) - Date.parse(submittedAt),
      }));
    },
  };
}
