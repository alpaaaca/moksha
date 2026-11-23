// What moksha's ideas mean, in a sentence each, for the hints next to
// the words people meet in the UI.
export const WORDS = {
  pipeline: "Your code that describes the work: which steps run, in what order, with which inputs.",
  run: "One execution of a pipeline, for some inputs (such as a day).",
  loop: "A pipeline that runs until it is stopped. Every so often it continues as a new run, so its history stays short; here those runs count as one.",
  signal: "Input from outside for a run in progress, such as an approval or a file that arrived. The run waits, holding no worker, until it comes or the wait times out.",
  step: "One function call in a pipeline that does real work: reads, computes, writes. What it writes is saved as a new version of a dataset.",
  reused:
    "moksha remembers what each step produced, with the inputs and code that produced it. When a step comes again with the same inputs and the same code, it reuses that instead of running again.",
  version:
    "Each time a step writes data, it becomes a new version of a dataset. A version is never changed afterwards, so you can always see what a run read and wrote.",
  dataset: "A named table or file, such as raw.orders, that gets a new version each time a step writes it (per day, for example).",
  inputs: "The values a run was started with, such as the day it is for.",
  history: "What happened in this run, in order: each step queued, started, done or reused, retries and waits.",
  checkpoint:
    "When a step ends, moksha saves how it ended (its result, or its failure) in the run's event log before going on. A checkpointed step never runs again in that run, even if the server or a worker restarts: the run reads its saved result instead.",
  schedule: "When the pipeline runs on its own (a cron expression), and which slice of data (interval) each run covers.",
} as const;

export type Word = keyof typeof WORDS;

// Hint is a small "?" next to a word that says what it means, on hover or focus.
export function Hint({ word }: { word: Word }) {
  return (
    <span className="hint" tabIndex={0} role="note" aria-label={`${word}: ${WORDS[word]}`} title={WORDS[word]}>
      ?
    </span>
  );
}
