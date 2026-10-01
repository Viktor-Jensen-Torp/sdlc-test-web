// The router: the one place that decides which role runs on what.
//
// Every installed role drops a rule into .github/aw/rules/<role>.json. A repo
// changes a rule by adding <role>.local.json beside it; its fields win. On each
// wake (a GitHub event, a nudge from a role that finished, or the clock) the
// router reads every rule, looks at the item's state, and dispatches each role
// whose rule matches. Roles never start each other.
//
// Rule fields (all optional except wakes-on and when.item):
//   wakes-on          events to consider: "pull_request", "issues", "workflow_dispatch", "schedule"
//   workflow          the lock file to dispatch; default "<role>.lock.yml"
//   when.item         "pr" or "issue"
//   when.draft        false to skip draft pull requests, true for drafts only
//   when.labels       every one of these labels must be on the item
//   when.labels-not   none of these labels may be on the item
//   when.check-missing  no check run of this name on the head commit yet
//   when.check-failed   a check of this name failed on the head commit ("*": any check)
//   when.conflicted     true: the pull request has merge conflicts
//   when.no-open-pr     true: no open pull request says "Fixes #<issue>"
//   when.any            a list of conditions; at least one must hold
//   limit.running     at most this many runs of the role on one item at once
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const RULES_DIR = ".github/aw/rules";
const repo = process.env.GITHUB_REPOSITORY;
// Rules name "pull_request"; the router listens with pull_request_target.
const event = process.env.EVENT === "pull_request_target" ? "pull_request" : process.env.EVENT;
const dryRun = !process.env.GH_TOKEN;

const gh = (args) => execFileSync("gh", args, { encoding: "utf8" });
const api = (route) => JSON.parse(gh(["api", route]));

function loadRules() {
  if (!fs.existsSync(RULES_DIR)) return [];
  const read = (f) => JSON.parse(fs.readFileSync(path.join(RULES_DIR, f), "utf8"));
  return fs
    .readdirSync(RULES_DIR)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".local.json"))
    .map((f) => {
      const role = path.basename(f, ".json");
      const rule = read(f);
      const local = `${role}.local.json`;
      if (fs.existsSync(path.join(RULES_DIR, local))) {
        const over = read(local);
        Object.assign(rule, over, { when: { ...rule.when, ...over.when }, limit: { ...rule.limit, ...over.limit } });
      }
      return { role, workflow: `${role}.lock.yml`, when: {}, limit: {}, ...rule };
    });
}

// The items this wake is about: [{ kind: "pr" | "issue", n }].
function itemsForEvent() {
  const payload = process.env.GITHUB_EVENT_PATH
    ? JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"))
    : {};
  const inputs = payload.inputs || {};
  if (event === "pull_request" || event === "pull_request_target") return [{ kind: "pr", n: payload.pull_request.number }];
  if (event === "issues") return [{ kind: "issue", n: payload.issue.number }];
  if (event === "workflow_dispatch" && inputs.pr) return [{ kind: "pr", n: Number(inputs.pr) }];
  if (event === "workflow_dispatch" && inputs.issue) return [{ kind: "issue", n: Number(inputs.issue) }];
  // The clock, or a nudge naming nothing: every open item.
  const prs = api(`repos/${repo}/pulls?state=open&per_page=100`).map((p) => ({ kind: "pr", n: p.number }));
  const issues = api(`repos/${repo}/issues?state=open&per_page=100`)
    .filter((i) => !i.pull_request)
    .map((i) => ({ kind: "issue", n: i.number }));
  return [...prs, ...issues];
}

function state(item) {
  if (item.kind === "issue") {
    const issue = api(`repos/${repo}/issues/${item.n}`);
    return { ...item, labels: issue.labels.map((l) => l.name) };
  }
  const pr = api(`repos/${repo}/pulls/${item.n}`);
  const checks = api(`repos/${repo}/commits/${pr.head.sha}/check-runs?per_page=100`).check_runs;
  return {
    ...item,
    sha: pr.head.sha,
    draft: pr.draft,
    labels: pr.labels.map((l) => l.name),
    checks: checks.map((c) => ({ name: c.name, conclusion: c.conclusion })),
    conflicted: pr.mergeable_state === "dirty",
  };
}

let openPrBodies;
function hasOpenPr(issue) {
  openPrBodies ??= api(`repos/${repo}/pulls?state=open&per_page=100`).map((p) => p.body || "");
  const fixes = new RegExp(`\\b(fixes|closes|resolves) #${issue}\\b`, "i");
  return openPrBodies.some((b) => fixes.test(b));
}

function running(rule, n) {
  const runs = api(`repos/${repo}/actions/workflows/${rule.workflow}/runs?per_page=50`).workflow_runs;
  return runs.filter((r) => r.status !== "completed" && new RegExp(`#${n}\\b`).test(r.display_title)).length;
}

// Why the conditions do not hold, or null when they do.
function unmet(w, s) {
  if (w.draft !== undefined && w.draft !== s.draft) return s.draft ? "is a draft" : "is not a draft";
  for (const l of w.labels || []) if (!s.labels.includes(l)) return `lacks label ${l}`;
  for (const l of w["labels-not"] || []) if (s.labels.includes(l)) return `has label ${l}`;
  if (w["check-missing"] && s.checks.some((c) => c.name === w["check-missing"])) return `already has ${w["check-missing"]}`;
  if (w["check-failed"]) {
    const name = w["check-failed"];
    if (!s.checks.some((c) => c.conclusion === "failure" && (name === "*" || c.name === name))) return `no failed check ${name}`;
  }
  if (w.conflicted !== undefined && w.conflicted !== s.conflicted) return s.conflicted ? "is conflicted" : "is not conflicted";
  if (w["no-open-pr"] && hasOpenPr(s.n)) return "already has an open pull request";
  if (w.any && !w.any.some((sub) => unmet(sub, s) === null)) return "none of its alternatives hold";
  return null;
}

function mismatch(rule, s) {
  if (rule.when.item !== s.kind) return `is for ${rule.when.item}s`;
  if (!rule["wakes-on"].includes(event)) return `does not wake on ${event}`;
  const why = unmet(rule.when, s);
  if (why) return why;
  if (rule.limit.running !== undefined && !dryRun && running(rule, s.n) >= rule.limit.running) return "is already running";
  return null;
}

function dispatch(rule, s) {
  const pr = s.kind === "pr";
  const context = JSON.stringify({
    item_type: pr ? "pull_request" : "issue", item_number: String(s.n), event_type: pr ? "pull_request" : "issues",
    repo, run_id: process.env.GITHUB_RUN_ID || "", run_attempt: process.env.GITHUB_RUN_ATTEMPT || "",
    workflow_id: process.env.GITHUB_WORKFLOW_REF || "",
  });
  const args = ["workflow", "run", rule.workflow, "--repo", repo, "-f", `${pr ? "pr" : "issue"}=${s.n}`, "-f", `aw_context=${context}`];
  if (dryRun) return console.log(`  (dry run) gh ${args.join(" ")}`);
  gh(args);
}

const rules = loadRules();
console.log(`rules: ${rules.map((r) => r.role).join(", ") || "(none)"}`);
if (rules.length === 0) process.exit(0);

for (const item of itemsForEvent()) {
  const s = state(item);
  for (const rule of rules) {
    const why = mismatch(rule, s);
    if (why && why.startsWith("is for ")) continue;
    console.log(`${s.kind} #${s.n} ${rule.role}: ${why ? `skip, ${why}` : "dispatch"}`);
    if (!why) dispatch(rule, s);
  }
}
