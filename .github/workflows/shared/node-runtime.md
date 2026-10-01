---
description: >
  Node and the project's dependencies for roles that write code. Installed
  before the agent starts, because the agent's firewall blocks the npm
  registry. Never fails the job.

runtimes:
  node:
    version: "22"

pre-agent-steps:
  - name: Install the project's dependencies
    run: |
      if [ -f package-lock.json ]; then
        npm ci --ignore-scripts --no-audit --no-fund --loglevel=error \
          || echo "::warning::npm ci failed; the agent's checks may not run"
      else
        echo "no package-lock.json; nothing to install"
      fi
---
