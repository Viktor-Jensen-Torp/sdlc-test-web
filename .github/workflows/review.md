---
emoji: "🔎"
description: Reviews a pull request's changed lines and posts line comments, one review, and an "Agent review" check.

# Started by the router (base package) when the rule in
# .github/aw/rules/review.json matches. Never by itself.
on:
  workflow_dispatch:
    inputs:
      pr:
        description: "Number of the pull request to review"
        required: true
        type: string
  # The router dispatches with GITHUB_TOKEN, which runs as github-actions[bot].
  bots: [github-actions]

run-name: "Review #${{ github.event.inputs.pr }}"

# One review per pull request at a time; a newer dispatch replaces one in flight.
concurrency:
  group: "gh-aw-${{ github.workflow }}-${{ github.event.inputs.pr }}"
  cancel-in-progress: true
  job-discriminator: ${{ github.event.inputs.pr }}

permissions:
  contents: read
  pull-requests: read

# When the review is posted, nudge the router: another role's rule may now
# match (rework, on a failed review). A dispatch made with GITHUB_TOKEN is the
# one write by this token that starts a workflow.
jobs:
  conclusion:
    permissions:
      actions: write
    pre-steps:
      - name: Nudge the router
        env:
          GH_TOKEN: ${{ github.token }}
          REPO: ${{ github.repository }}
          PR: ${{ github.event.inputs.pr }}
        run: gh workflow run router.yml --repo "$REPO" -f pr="$PR" || echo "::warning::could not nudge the router"

engine:
  id: pi
model: anthropic/claude-haiku-4-5-20251001

max-ai-credits: 100
max-turns: 150
timeout-minutes: 15

imports:
  - shared/pr-context.md
  - ../aw/roles/review/prompt.md

cache:
  key: pr-prefetch-${{ github.event.inputs.pr }}-${{ github.run_id }}
  path: /tmp/gh-aw/agent

tools:
  cli-proxy: true
  github:
    mode: gh-proxy
    min-integrity: approved
    toolsets: [pull_requests, repos]
  comment-memory:
    memory-id: review

safe-outputs:
  # Posts as the reviewer App, so the review and check carry its name.
  github-app:
    client-id: ${{ vars.REVIEWER_CLIENT_ID }}
    private-key: ${{ secrets.REVIEWER_APP_PRIVATE_KEY }}
  create-pull-request-review-comment:
    max: 10
    side: "RIGHT"
  submit-pull-request-review:
    max: 1
    # A bot cannot APPROVE; see gh-aw's .github/aw/pr-reviewer.md.
    allowed-events: [COMMENT, REQUEST_CHANGES]
    supersede-older-reviews: true
  # The verdict as a check, so a ruleset can require it and other roles' rules
  # can read it. Keep the name stable.
  create-check-run:
    name: "Agent review"
    max: 1
    target: triggering
  noop:
  threat-detection:
    engine:
      id: claude
      model: claude-haiku-4-5-20251001
    continue-on-error: false
    retries: 2
    max-ai-credits: 150

evals:
  - id: review_submitted
    question: Did the agent submit exactly one pull request review, with the event set to COMMENT or REQUEST_CHANGES?
  - id: findings_scoped
    question: Are all of the agent's review comments about lines that appear in the pull request diff?
  - id: check_agrees
    question: Does the "Agent review" check's conclusion agree with the review event (failure for REQUEST_CHANGES, success for COMMENT)?
source: Viktor-Jensen-Torp/umain-sdlc@95633adbf6e264e16af3f2904368c9a53a4b1a6a
---

# Review

You are reviewing pull request #${{ github.event.inputs.pr }} in
${{ github.repository }}. Follow the instructions below.