// Live status of a pipeline run, for the Dashboard tab of the phone web app.
//
// In GitHub Actions (GITHUB_TOKEN + GITHUB_REPOSITORY set) the status is pushed to the `status` branch of
// the repo while the run is going: status/run.json (the latest run that did something or failed: phases,
// terminal lines, failure reason, next attempt) and status/history.json (one line per run). The phone reads
// them through the GitHub contents API. Locally nothing is published; the module is a no-op.
const REPO = process.env.GITHUB_REPOSITORY;
const TOKEN = process.env.GITHUB_TOKEN;
const BRANCH = "status";
const ENABLED = Boolean(REPO && TOKEN) && process.env.STATUS_PUBLISH !== "0";
const MAX_LINES = 600;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const run = {
  runId: process.env.GITHUB_RUN_ID ?? `local-${Date.now()}`,
  runUrl: process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${REPO}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
  trigger: process.env.GITHUB_EVENT_NAME ?? "local",
  attempt: Number(process.env.RUN_ATTEMPT ?? 1),
  willRetry: process.env.WILL_RETRY === "1",
  state: "running", // running | success | failed
  startedAt: new Date().toISOString(),
  updatedAt: null,
  finishedAt: null,
  days: [],
  phases: [],
  failure: null,
  next: null,
  summary: "",
  lines: [],
};
let published = process.env.STATUS_ALWAYS === "1"; // publish even a run with nothing to do

// On a retry, keep what the failed first attempt of this same workflow run logged.
export async function init() {
  if (!ENABLED || run.attempt < 2) return;
  try {
    const cur = await gh(`/contents/status/run.json?ref=${BRANCH}`);
    if (!cur.ok) return;
    const meta = await cur.json();
    const old = JSON.parse(Buffer.from(meta.content, "base64").toString("utf8"));
    if (old.runId !== run.runId) return;
    shas.set("status/run.json", meta.sha);
    run.previous = { attempt: old.attempt, failure: old.failure, lines: (old.lines ?? []).slice(-150) };
  } catch {
    // the retry works without it
  }
}

// ---- recording --------------------------------------------------------------------------------
export function setDays(days) {
  run.days = days;
}

export function phase(id, label, state, detail = "", day = null) {
  const existing = run.phases.find((p) => p.id === id && p.day === day);
  const entry = { id, day, label, state, detail, at: new Date().toISOString() };
  if (existing) Object.assign(existing, entry);
  else run.phases.push(entry);
  touch();
}

export function line(level, msg) {
  run.lines.push({ t: new Date().toISOString(), l: level, m: String(msg).slice(0, 400) });
  if (run.lines.length > MAX_LINES) run.lines.splice(0, run.lines.length - MAX_LINES);
  touch();
}

export const recentLines = (n = 80) => run.lines.slice(-n).map((l) => l.m);

// Start publishing: called as soon as the run has real work (or has failed).
export function publish() {
  published = true;
  touch();
}

export function setFailure(phaseLabel, day, { reason, hint }) {
  run.failure = { phase: phaseLabel, day, reason, hint };
  touch();
}

// Next scheduled workflow run (05:00 and 19:00 UTC on weekdays), after `from`.
export function nextScheduled(from = new Date()) {
  for (let add = 0; add < 8; add++) {
    for (const hour of [5, 19]) {
      const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + add, hour));
      const dow = d.getUTCDay();
      if (d > from && dow >= 1 && dow <= 5) return d;
    }
  }
  return null;
}

export async function finish(state, summary) {
  run.state = state;
  run.summary = summary;
  run.finishedAt = new Date().toISOString();
  if (state === "failed") {
    run.next = run.willRetry
      ? { at: new Date(Date.now() + 60_000).toISOString(), why: `Automatic retry (attempt ${run.attempt + 1} of 2)` }
      : { at: nextScheduled()?.toISOString() ?? null, why: "Next scheduled check (or press Run workflow on GitHub)" };
  } else {
    run.next = { at: nextScheduled()?.toISOString() ?? null, why: "Next scheduled check" };
  }
  // an attempt that is about to be retried is not the final word; the history only gets the last attempt
  touch();
  await drain();
  if (ENABLED) {
    try {
      await pushHistory();
    } catch (e) {
      console.warn(`status: history not saved (${e.message})`);
    }
  }
}

// ---- publishing to the status branch ---------------------------------------------------------------
let dirty = false;
let flushing = null;
const shas = new Map();

function touch() {
  run.updatedAt = new Date().toISOString();
  if (!ENABLED || !published) return;
  dirty = true;
  if (!flushing) {
    flushing = (async () => {
      while (dirty) {
        dirty = false;
        try {
          await putJson("status/run.json", run);
        } catch (e) {
          console.warn(`status: not published (${e.message})`);
        }
        await sleep(2500); // at most one push every few seconds
      }
      flushing = null;
    })();
  }
}

async function drain() {
  while (flushing) await flushing;
}

const gh = (path, opts = {}) =>
  fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(20_000),
  });

let branchReady = false;
async function ensureBranch() {
  if (branchReady) return;
  if ((await gh(`/git/ref/heads/${BRANCH}`)).ok) return void (branchReady = true);
  // an orphan branch, so the status commits never mix with the code history
  const tree = await (await gh("/git/trees", { method: "POST", body: JSON.stringify({ tree: [{ path: "status/README.md", mode: "100644", type: "blob", content: "Live pipeline status for the Lunch Photo dashboard. Written by status.mjs.\n" }] }) })).json();
  const commit = await (await gh("/git/commits", { method: "POST", body: JSON.stringify({ message: "Create status branch", tree: tree.sha, parents: [] }) })).json();
  const ref = await gh("/git/refs", { method: "POST", body: JSON.stringify({ ref: `refs/heads/${BRANCH}`, sha: commit.sha }) });
  if (!ref.ok && ref.status !== 422) throw new Error(`creating the status branch failed (HTTP ${ref.status})`);
  branchReady = true;
}

async function putJson(path, value) {
  await ensureBranch();
  const content = Buffer.from(JSON.stringify(value) + "\n").toString("base64");
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!shas.has(path)) {
      const cur = await gh(`/contents/${path}?ref=${BRANCH}`);
      shas.set(path, cur.ok ? (await cur.json()).sha : undefined);
    }
    const res = await gh(`/contents/${path}`, {
      method: "PUT",
      body: JSON.stringify({ message: "status", content, branch: BRANCH, sha: shas.get(path) }),
    });
    if (res.ok) {
      shas.set(path, (await res.json()).content.sha);
      return;
    }
    if (res.status === 409 || res.status === 422) shas.delete(path); // stale sha: fetch it again
    else throw new Error(`HTTP ${res.status}`);
  }
  throw new Error("could not update the file (conflict)");
}

async function pushHistory() {
  let history = [];
  const cur = await gh(`/contents/status/history.json?ref=${BRANCH}`);
  if (cur.ok) {
    const meta = await cur.json();
    shas.set("status/history.json", meta.sha);
    history = JSON.parse(Buffer.from(meta.content, "base64").toString("utf8"));
  }
  history = history.filter((h) => h.runId !== run.runId);
  history.push({
    runId: run.runId,
    runUrl: run.runUrl,
    trigger: run.trigger,
    attempt: run.attempt,
    state: run.state,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    summary: run.summary,
    detailed: published, // true when status/run.json holds this run's log
  });
  await putJson("status/history.json", history.slice(-40));
}

// ---- turning an error into words -----------------------------------------------------------------------
// `phaseId` is the step that failed; the recent terminal lines are searched for a known cause.
export function explain(phaseId, lines) {
  const text = lines.join("\n");
  const geminiPhase = ["ingredients", "match", "portions"].includes(phaseId);
  const rules = [
    [/Login failed/, "Kalorické tabulky rejected the bot login", "Check the KT_EMAIL / KT_PASSWORD secrets - was the bot password changed?"],
    [/not one of the bot account's connected people/, "A recipient in KT_SEND_TO is not connected to the bot account", "Add that person in Kalorické tabulky for the bot account, or fix the e-mail in the KT_SEND_TO secret."],
    [/Expected \d+ entries in Oběd/, "Writing to the diary did not add every food", "Open the bot's Oběd for that day and delete the partial entries, then run the workflow again."],
    [/Oběd on \S+ is empty/, "There was nothing to send because the diary day is empty", "The write step did not finish. Check the log above it."],
    [/photos\/\S+ not found/, "The lunch photo is missing", "Upload the photo again in the app."],
    [/No ingredients for/, "The ingredients for this meal were never created", "The ingredients step failed earlier - see the run before this one."],
    [/Gemini HTTP 4\d\d/, "Gemini rejected the request", "Check that the GEMINI_API_KEY secret is valid and not out of quota.", geminiPhase],
    [/UND_ERR_HEADERS_TIMEOUT|no answer in 60 s|Headers Timeout/, "Gemini stopped answering", "Usually temporary. Every request now times out after 60 s and tries another model; the next attempt starts fresh.", geminiPhase],
    [/Gemini kept failing|HTTP 429|HTTP 503/, "Gemini is overloaded (free tier) - every model failed several times", "Temporary. Try again later; days already finished are kept.", geminiPhase],
    [/ENOTFOUND|ECONNRESET|ETIMEDOUT|fetch failed/, "Network problem reaching an online service", "Usually temporary - the next attempt tries again."],
  ];
  for (const [re, reason, hint, only] of rules) {
    if (only === false) continue;
    if (re.test(text)) return { reason, hint };
  }
  const lastError = [...lines].reverse().find((l) => /error|failed|exit/i.test(l)) ?? lines.at(-1) ?? "unknown error";
  return { reason: lastError.trim().slice(0, 200), hint: "See the terminal log below for details." };
}
