import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_INPUTS } from "../data/assumptions";
import { HAS_LOCAL_PROFILE, LOCAL_PROFILE } from "../data/profile";
import { deterministicPath } from "../engine/returns";
import { buildContext, runPath } from "../engine/simulate";
import type { MonteCarloSummary, SimInputs, SolveResult, TornadoRow } from "../engine/types";
import { DeterministicView } from "./DeterministicView";
import { InputsPanel } from "./InputsPanel";
import { MonteCarloView } from "./MonteCarloView";
import { ScenariosView } from "./ScenariosView";
import { SensitivityView } from "./SensitivityView";

const STORAGE_KEY = "myers-fire-inputs-v1";

/** The starting profile when there's no valid saved session. */
const BASE_PROFILE: SimInputs = LOCAL_PROFILE ?? DEFAULT_INPUTS;

function merge(base: SimInputs, over: Partial<SimInputs>): SimInputs {
  return { ...base, ...over, balances: { ...base.balances, ...over.balances } };
}

/** Did we load a real saved session (vs. showing the example for the first time)? */
function hasSavedSession(): boolean {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return !!(parsed && parsed.balances && parsed.nameA);
  } catch {
    return false;
  }
}

function loadInputs(): SimInputs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Only honor saves that have the current shape (balances + names). Older
      // pre-profile saves are ignored so we cleanly adopt the local profile.
      if (parsed && parsed.balances && parsed.nameA) return merge(DEFAULT_INPUTS, parsed);
    }
  } catch {
    // corrupted storage — fall through
  }
  return BASE_PROFILE;
}

type WorkerReply =
  | { seq: number; kind: "mc"; summary: MonteCarloSummary }
  | { seq: number; kind: "solve"; solve: SolveResult }
  | { seq: number; kind: "tornado"; tornado: TornadoRow[] };

export function App() {
  const [inputs, setInputs] = useState<SimInputs>(loadInputs);
  const [tab, setTab] = useState<"deterministic" | "montecarlo" | "scenarios" | "sensitivity">("deterministic");
  const [summary, setSummary] = useState<MonteCarloSummary | null>(null);
  const [running, setRunning] = useState(false);
  // Welcome the first-time visitor (no local profile, no saved session).
  const [showWelcome, setShowWelcome] = useState(!HAS_LOCAL_PROFILE && !hasSavedSession());
  const workerRef = useRef<Worker | null>(null);
  const seqRef = useRef(0);
  const pendingRef = useRef(new Map<number, (reply: WorkerReply) => void>());
  const latestMcSeqRef = useRef(0);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(inputs));
  }, [inputs]);

  useEffect(() => {
    const w = new Worker(new URL("./mcWorker.ts", import.meta.url), { type: "module" });
    workerRef.current = w;
    w.onmessage = (e: MessageEvent<WorkerReply>) => {
      const resolve = pendingRef.current.get(e.data.seq);
      pendingRef.current.delete(e.data.seq);
      resolve?.(e.data);
    };
    return () => w.terminate();
  }, []);

  /** Post a job to the engine worker; resolves with its reply. */
  const runJob = useCallback((job: Record<string, unknown>): Promise<WorkerReply> => {
    const seq = ++seqRef.current;
    return new Promise((resolve) => {
      pendingRef.current.set(seq, resolve);
      workerRef.current?.postMessage({ seq, ...job });
    });
  }, []);

  const runMc = useCallback(
    async (mcInputs: SimInputs): Promise<MonteCarloSummary> => {
      const reply = await runJob({ kind: "mc", inputs: mcInputs });
      if (reply.kind !== "mc") throw new Error("unexpected worker reply");
      return reply.summary;
    },
    [runJob],
  );

  const runSolve = useCallback(
    async (spouse: "caleb" | "katy", targetPct: number): Promise<SolveResult> => {
      const reply = await runJob({ kind: "solve", inputs, spouse, targetPct });
      if (reply.kind !== "solve") throw new Error("unexpected worker reply");
      return reply.solve;
    },
    [runJob, inputs],
  );

  const runTornado = useCallback(
    async (tInputs: SimInputs): Promise<TornadoRow[]> => {
      const reply = await runJob({ kind: "tornado", inputs: tInputs });
      if (reply.kind !== "tornado") throw new Error("unexpected worker reply");
      return reply.tornado;
    },
    [runJob],
  );

  // The main Monte Carlo run: debounced on input change; stale results dropped.
  useEffect(() => {
    const t = setTimeout(() => {
      const mySeq = seqRef.current + 1;
      latestMcSeqRef.current = mySeq;
      setRunning(true);
      runMc(inputs).then((s) => {
        if (latestMcSeqRef.current === mySeq) {
          setSummary(s);
          setRunning(false);
        }
      });
    }, 300);
    return () => clearTimeout(t);
  }, [inputs, runMc]);

  const deterministic = useMemo(
    () => runPath(buildContext(inputs), deterministicPath(inputs)),
    [inputs],
  );

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(inputs, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "myers-fire-assumptions.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = (file: File) => {
    file.text().then((text) => {
      try {
        setInputs({ ...DEFAULT_INPUTS, ...JSON.parse(text) });
      } catch {
        alert("Could not parse that file as assumptions JSON.");
      }
    });
  };

  return (
    <div className="app">
      <aside>
        <h1>FIRE Bridge Model</h1>
        <div className="io-row">
          <button className="ghost" onClick={exportJson}>Export</button>
          <label className="ghost button-like">
            Import
            <input
              type="file"
              accept=".json"
              hidden
              onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])}
            />
          </label>
        </div>
        <InputsPanel
          inputs={inputs}
          onChange={setInputs}
          onReset={() => setInputs(BASE_PROFILE)}
          onLoadExample={HAS_LOCAL_PROFILE ? () => setInputs(DEFAULT_INPUTS) : undefined}
        />
      </aside>
      <main>
        {showWelcome && (
          <div className="welcome">
            <button className="welcome-x" onClick={() => setShowWelcome(false)} title="Dismiss">×</button>
            <b>Welcome — this is a sample household.</b> Put in your own numbers in the sidebar
            (start with <em>Household &amp; balances</em>), or <em>Import</em> a saved file. Nothing you
            enter leaves your browser — there's no server. Everything auto-saves locally; to load your
            data automatically every visit, see <code>profile.local.example.ts</code> in the README.
          </div>
        )}
        <nav className="tabs">
          <button className={tab === "deterministic" ? "active" : ""} onClick={() => setTab("deterministic")}>
            Deterministic
          </button>
          <button className={tab === "montecarlo" ? "active" : ""} onClick={() => setTab("montecarlo")}>
            Monte Carlo {running && <span className="spinner" />}
          </button>
          <button className={tab === "scenarios" ? "active" : ""} onClick={() => setTab("scenarios")}>
            Scenarios
          </button>
          <button className={tab === "sensitivity" ? "active" : ""} onClick={() => setTab("sensitivity")}>
            Sensitivity
          </button>
        </nav>
        {tab === "deterministic" ? (
          <DeterministicView inputs={inputs} result={deterministic} />
        ) : tab === "montecarlo" ? (
          <MonteCarloView inputs={inputs} summary={summary} running={running} onSolve={runSolve} />
        ) : tab === "scenarios" ? (
          <ScenariosView currentInputs={inputs} onLoad={setInputs} runMc={runMc} />
        ) : (
          <SensitivityView inputs={inputs} runTornado={runTornado} />
        )}
        <footer>
          Model precision exceeds input precision past a point — a 50-year projection is
          inherently fuzzy. The value is seeing which levers move the outcome (re-entry income,
          spending flexibility, retirement timing), not a single “right answer.” Illustrative
          planning tool; not financial, tax, or legal advice.
        </footer>
      </main>
    </div>
  );
}
