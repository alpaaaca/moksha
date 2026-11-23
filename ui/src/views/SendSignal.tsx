import { useState, type FormEvent } from "react";

import { useApi } from "../api";
import { message } from "../hooks";

// SendSignal answers one wait: its name is known, only the payload is asked.
export function SendSignal({ runId, name, onSent }: { runId: string; name: string; onSent: () => void }) {
  const api = useApi();
  const [payload, setPayload] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (payload) {
      try {
        JSON.parse(payload);
      } catch {
        setError('the payload must be JSON, e.g. {"by": "ana"}');
        return;
      }
    }
    setSending(true);
    try {
      await api.runs.signalRun({ runId, name, payloadJson: payload });
      setPayload("");
      onSent();
    } catch (err) {
      setError(message(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <form className="send-signal" onSubmit={submit}>
      <input aria-label={`${name} payload`} className="mono" placeholder="payload JSON (optional)" value={payload} onChange={(e) => setPayload(e.target.value)} />
      <button type="submit" disabled={sending}>
        Send {name}
      </button>
      {error && <span className="error small">{error}</span>}
    </form>
  );
}
