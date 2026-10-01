// The router: the one place that decides which role runs on what.
//
// Every installed role drops a rule into .github/aw/rules/<role>.json. A repo
// changes a rule by adding <role>.local.json beside it; its fields win. On each
// wake (a GitHub event, a nudge, or the clock) the router reads every rule,
// looks at the pull request's state, and dispatches each role whose rule
// matches. Roles never start each other.
//
// Rule fields (all optional except wakes-on):
//   wakes-on        ["pull_request", "workflow_dispatch", "schedule"]
//   workflow        the lock file to dispatch; default "<role>.lock.yml"
//   when.item       "pr" (the only kind so far)
//   when.draft      false to skip drafts, true for drafts only
//   when.labels     every one of these labels must be on the item
//   when.labels-not none of these labels may be on the item
//   when.check-missing  no check run of this name on the head commit yet
//   limit.running   at most this many runs of the role on the item at once
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const RULES_DIR = ".github/aw/rules";
const repo = process.env.GITHUB_REPOSITORY;
const event = process.env.EVENT;
const dryRun = !process.env.GH_TOKEN;

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8" });
}
function api(route) {
  return JSON.parse(gh(["api", route]));
}

function loadRules() {
  if (!fs.existsSync(RULES_DIR)) return [];
  const files = fs.readdirSync(RULES_DIR).filter((f) => f.endsWith(".json") && !f.endsWith(".local.json"));
  return files.map((f) => {
    const role = path.basename(f, ".json");
    const read = (p) => JSON.parse(fs.readFileSync(path.join(RULES_DIR, p), "utf8"));
    const rule = read(f);
    const local = `${role}.local.json`;
    if (fs.existsSync(path.join(RULES_DIR, local))) {
      const over = read(local);
      Object.assign(rule, over, { when: { ...rule.when, ...over.when }, limit: { ...rule.limit, ...over.limit } });
    }
    return { role, workflow: `${role}.lock.yml`, when: {}, limit: {}, ...rule };
  });
}

// The pull requests this wake is about.
function itemsForEvent() {
  const payload = process.env.GITHUB_EVENT_PATH
    ? JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"))
    : {};
  if (event === "pull_request") return [payload.pull_request.number];
  if (event === "workflow_dispatch" && payload.inputs && payload.inputs.pr) return [Number(payload.inputs.pr)];
  if (event === "schedule" || event === "workflow_dispatch") {
    return api(`repos/${repo}/pulls?state=open&per_page=100`).map((p) => p.number);
  }
  return [];
}

function prState(n) {
  const pr = api(`repos/${repo}/pulls/${n}`);
  const checks = api(`repos/${repo}/commits/${pr.head.sha}/check-runs?per_page=100`).check_runs.map((c) => c.name);
  return { n, sha: pr.head.sha, draft: pr.draft, labels: pr.labels.map((l) => l.name), checks };
}

function running(rule, n) {
  const runs = api(`repos/${repo}/actions/workflows/${rule.workflow}/runs?per_page=50`).workflow_runs;
  return runs.filter((r) => r.status !== "completed" && new RegExp(`#${n}\\b`).test(r.display_title)).length;
}

// Why a rule does not match, or null when it does.
function mismatch(rule, s) {
  const w = rule.when;
  if (!rule["wakes-on"].includes(event)) return `does not wake on ${event}`;
  if (w.draft !== undefined && w.draft !== s.draft) return s.draft ? "is a draft" : "is not a draft";
  for (const l of w.labels || []) if (!s.labels.includes(l)) return `lacks label ${l}`;
  for (const l of w["labels-not"] || []) if (s.labels.includes(l)) return `has label ${l}`;
  if (w["check-missing"] && s.checks.includes(w["check-missing"])) return `already has ${w["check-missing"]}`;
  if (rule.limit.running !== undefined && !dryRun && running(rule, s.n) >= rule.limit.running) return "is already running";
  return null;
}

function dispatch(rule, s) {
  const context = JSON.stringify({
    item_type: "pull_request", item_number: String(s.n), event_type: "pull_request", repo,
    run_id: process.env.GITHUB_RUN_ID || "", run_attempt: process.env.GITHUB_RUN_ATTEMPT || "",
    workflow_id: process.env.GITHUB_WORKFLOW_REF || "",
  });
  const args = ["workflow", "run", rule.workflow, "--repo", repo, "-f", `pr=${s.n}`, "-f", `aw_context=${context}`];
  if (dryRun) return console.log(`  (dry run) gh ${args.join(" ")}`);
  gh(args);
}

const rules = loadRules();
console.log(`rules: ${rules.map((r) => r.role).join(", ") || "(none)"}`);
if (rules.length === 0) process.exit(0);

for (const n of itemsForEvent()) {
  const s = prState(n);
  for (const rule of rules) {
    const why = mismatch(rule, s);
    console.log(`PR #${n} ${rule.role}: ${why ? `skip, ${why}` : "dispatch"}`);
    if (!why) dispatch(rule, s);
  }
}
