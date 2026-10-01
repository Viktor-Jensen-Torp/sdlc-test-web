---
emoji: "🔧"
description: Fixes an agent pull request that came back - a failed review, a failed check, or a merge conflict - and pushes the fix. At most three rounds before a person is called.

# Started by the router (base package) when the rule in
# .github/aw/rules/rework.json matches. Never by itself.
on:
  workflow_dispatch:
    inputs:
      pr:
        description: "Number of the pull request to rework"
        required: true
        type: string
  # The router dispatches with GITHUB_TOKEN, which runs as github-actions[bot].
  bots: [github-actions]

  permissions:
    contents: read
    pull-requests: write
    issues: write

  # Decides, before any agent time, what this round is for, and counts rounds
  # in labels (rework:1, rework:2). The third time a person is called instead.
  # Labels are written with GITHUB_TOKEN, so they start no workflow.
  steps:
    - name: Decide what this round is for
      id: gate
      env:
        GH_TOKEN: ${{ github.token }}
        REPO: ${{ github.repository }}
        PR: ${{ github.event.inputs.pr }}
        LIMIT: "3"
      run: |
        set -euo pipefail
        stop() { echo "$1"; echo "proceed=false" >> "$GITHUB_OUTPUT"; exit 0; }
        add_label() { gh api -X POST "repos/$REPO/issues/$PR/labels" -f "labels[]=$1" --silent; }
        J=$(gh pr view "$PR" --repo "$REPO" --json state,labels,mergeable,statusCheckRollup,isCrossRepository)
        [ "$(jq -r .state <<<"$J")" = OPEN ] || stop "#$PR is not open."
        [ "$(jq -r .isCrossRepository <<<"$J")" = false ] || stop "#$PR comes from a fork."
        LABELS=$(jq -r '.labels[].name' <<<"$J")
        grep -qx agent <<<"$LABELS" || stop "#$PR is not an agent pull request; its author fixes it."
        if grep -qxE 'needs-human|paused' <<<"$LABELS"; then stop "#$PR is held by a person."; fi

        if [ "$(jq -r .mergeable <<<"$J")" = CONFLICTING ]; then TASK=resolve-conflict
        elif [ "$(jq '[.statusCheckRollup[]? | select(.name != "Agent review") | select(.conclusion == "FAILURE")] | length' <<<"$J")" -gt 0 ]; then TASK=fix-checks
        else TASK=address-review; fi

        N=0
        for i in 1 2 3 4 5; do grep -qx "rework:$i" <<<"$LABELS" && N=$i; done
        N=$((N + 1))
        if [ "$N" -ge "$LIMIT" ]; then
          add_label needs-human
          gh api -X POST "repos/$REPO/issues/$PR/comments" --silent \
            -f body="Rework has tried twice. A person owns this pull request now."
          stop "Round $N; handed to a person."
        fi
        add_label "rework:$N"
        echo "proceed=true" >> "$GITHUB_OUTPUT"
        echo "task=$TASK" >> "$GITHUB_OUTPUT"
        echo "round=$N" >> "$GITHUB_OUTPUT"
        echo "Round $N: $TASK"

jobs:
  pre-activation:
    outputs:
      proceed: ${{ steps.gate.outputs.proceed }}
      task: ${{ steps.gate.outputs.task }}
      round: ${{ steps.gate.outputs.round }}

if: needs.pre_activation.outputs.proceed == 'true'

run-name: "Rework #${{ github.event.inputs.pr }}"

concurrency:
  group: "gh-aw-${{ github.workflow }}-${{ github.event.inputs.pr }}"
  cancel-in-progress: false
  job-discriminator: ${{ github.event.inputs.pr }}

permissions:
  contents: read
  pull-requests: read

engine:
  id: pi
model: anthropic/claude-haiku-4-5-20251001

max-ai-credits: 150
max-turns: 150
timeout-minutes: 30

imports:
  - shared/node-runtime.md
  - ../aw/roles/rework/prompt.md

pre-agent-steps:
  - name: Write the review findings and checks to files
    env:
      GH_TOKEN: ${{ github.token }}
      REPO: ${{ github.repository }}
      PR: ${{ github.event.inputs.pr }}
    run: |
      set -euo pipefail
      mkdir -p /tmp/gh-aw/agent
      gh api "repos/$REPO/pulls/$PR/reviews" --paginate \
        --jq '.[] | {id, state, user: .user.login, body: .body[:4000]}' \
        | jq -s '.[-5:]' > /tmp/gh-aw/agent/reviews.json
      # Open findings only, each with its thread id so it can be resolved.
      gh api graphql --paginate -F owner="${REPO%/*}" -F name="${REPO#*/}" -F pr="$PR" -f query='
        query($owner: String!, $name: String!, $pr: Int!, $endCursor: String) {
          repository(owner: $owner, name: $name) { pullRequest(number: $pr) {
            reviewThreads(first: 50, after: $endCursor) {
              pageInfo { hasNextPage endCursor }
              nodes { id isResolved path line originalLine
                      comments(first: 1) { nodes { databaseId body author { login } } } } } } } }' \
        --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved | not)
              | {thread_id: .id, comment_id: .comments.nodes[0].databaseId, path,
                 line: (.line // .originalLine), body: .comments.nodes[0].body[:2000],
                 user: .comments.nodes[0].author.login}' \
        | jq -s '.' > /tmp/gh-aw/agent/review-comments.json
      gh pr view "$PR" --repo "$REPO" --json number,title,body,headRefName,baseRefName,statusCheckRollup \
        > /tmp/gh-aw/agent/pr-meta.json
      echo "$(jq length /tmp/gh-aw/agent/review-comments.json) open review threads"

tools:
  cli-proxy: true
  github:
    mode: gh-proxy
    min-integrity: approved
    toolsets: [pull_requests, repos]
  edit:
  bash: ["*"]

safe-outputs:
  # Pushes as the implementer App, so the push starts the repo's pull request
  # workflows (the router, CI) and the review runs again.
  github-app:
    client-id: ${{ vars.IMPLEMENTER_CLIENT_ID }}
    private-key: ${{ secrets.IMPLEMENTER_APP_PRIVATE_KEY }}
  push-to-pull-request-branch:
    target: "triggering"
    required-labels: [agent]
    protected-files: fallback-to-issue
    if-no-changes: error
    commit-title-suffix: " [rework]"
    check-branch-protection: false
  add-comment:
    max: 1
  reply-to-pull-request-review-comment:
    max: 10
  resolve-pull-request-review-thread:
    max: 10
  noop:
  report-incomplete:
  threat-detection:
    engine:
      id: claude
      model: claude-haiku-4-5-20251001
    continue-on-error: false
    retries: 2
    max-ai-credits: 150

evals:
  - id: addressed_findings
    question: Did the agent change code in response to the specific findings or failing checks it was given, rather than making unrelated edits?
  - id: no_test_weakening
    question: Did the agent avoid making a check pass by weakening or deleting a test?
source: Viktor-Jensen-Torp/umain-sdlc@9c526e20a872052542e8be93944d86a4240d6e97
---

# Rework

Pull request #${{ github.event.inputs.pr }} in ${{ github.repository }} came
back. This round's task is **${{ needs.pre_activation.outputs.task }}** (round
${{ needs.pre_activation.outputs.round }}). Follow the instructions below.
