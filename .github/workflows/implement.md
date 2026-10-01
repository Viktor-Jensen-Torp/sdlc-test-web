---
emoji: "🛠️"
description: Implements an issue as one pull request with tests, labelled agent.

# Started by the router (base package) when the rule in
# .github/aw/rules/implement.json matches. Never by itself.
on:
  workflow_dispatch:
    inputs:
      issue:
        description: "Number of the issue to implement"
        required: true
        type: string
  # The router dispatches with GITHUB_TOKEN, which runs as github-actions[bot].
  bots: [github-actions]

run-name: "Implement #${{ github.event.inputs.issue }}"

# One run per issue at a time; different issues side by side.
concurrency:
  group: "gh-aw-${{ github.workflow }}-${{ github.event.inputs.issue }}"
  cancel-in-progress: false
  job-discriminator: ${{ github.event.inputs.issue }}

permissions:
  contents: read
  issues: read

engine:
  id: pi
model: anthropic/claude-haiku-4-5-20251001

max-ai-credits: 150
max-turns: 150
timeout-minutes: 30

imports:
  - shared/node-runtime.md
  - ../aw/roles/implement/prompt.md

pre-agent-steps:
  - name: Write the issue to a file
    env:
      GH_TOKEN: ${{ github.token }}
      REPO: ${{ github.repository }}
      ISSUE: ${{ github.event.inputs.issue }}
    run: |
      set -euo pipefail
      mkdir -p /tmp/gh-aw/agent
      gh api "repos/$REPO/issues/$ISSUE" --jq '{number, title, body, labels: [.labels[].name]}' \
        > /tmp/gh-aw/agent/issue.json
      echo "issue #$ISSUE: $(jq -r .title /tmp/gh-aw/agent/issue.json)"

tools:
  cli-proxy: true
  github:
    mode: gh-proxy
    toolsets: [issues, repos]
  edit:
  # Pi does not support a bash allow-list, so bash is unrestricted inside the
  # firewalled container.
  bash: ["*"]

safe-outputs:
  # Opens the pull request as the implementer App, so it starts the repo's
  # pull request workflows (the router, CI) like a person's would.
  github-app:
    client-id: ${{ vars.IMPLEMENTER_CLIENT_ID }}
    private-key: ${{ secrets.IMPLEMENTER_APP_PRIVATE_KEY }}
  create-pull-request:
    draft: false
    # Marks agent work: rework only ever touches pull requests with this label.
    labels: [agent]
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
  - id: tests_added
    question: Were new or updated tests added for the behaviour this change introduces or fixes?
  - id: stayed_in_scope
    question: Does the change stay within what the issue asked for, without touching unrelated code?
source: Viktor-Jensen-Torp/umain-sdlc@95633adbf6e264e16af3f2904368c9a53a4b1a6a
---

# Implement

Implement issue #${{ github.event.inputs.issue }} in ${{ github.repository }}.
Follow the instructions below.