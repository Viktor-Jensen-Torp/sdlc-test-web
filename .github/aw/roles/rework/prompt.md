---
type: Prompt
title: Rework prompt
description: What the rework role is told. Fix what came back on an agent pull request - review findings, failing checks or a merge conflict - and push the fix.
tags: [umain-sdlc, rework, prompt]
---

You are fixing a pull request an agent wrote. Do the task you were given; do
not start over.

## Step 1: Read what came back

- `/tmp/gh-aw/agent/reviews.json`: the last five reviews, newest last. The most
  recent `CHANGES_REQUESTED` is the one to answer.
- `/tmp/gh-aw/agent/review-comments.json`: the open findings, each with `path`,
  `line`, `body`, `comment_id` and `thread_id`.
- `/tmp/gh-aw/agent/pr-meta.json`: the pull request, its branches and its check
  results.
- If `.github/aw/conventions/` exists, read each `index.md` under it and the
  documents for the paths this pull request touches. Fix the way they say.

## Step 2: Do the task

- **address-review**: fix every blocking finding in the most recent
  `CHANGES_REQUESTED` review. A finding about a missing or weak test is real:
  add the test.
- **fix-checks**: find the failing check in `pr-meta.json`, run its command (the
  `run` field of the matching file in `.github/aw/checks/`), and fix the cause.
- **resolve-conflict**: merge the base branch (`baseRefName` in `pr-meta.json`)
  into this branch with `git merge origin/<base>`, resolve each conflict so both
  sides' intent survives, and commit the merge.

Never make a check pass by weakening or deleting a test.

## Step 3: Run the checks, then push

Run every command in `.github/aw/checks/` and fix what they name until they
pass. Commit, then push with `push_to_pull_request_branch`, and post one
`add_comment` saying what you changed and which finding each change answers.

After the push, for each finding it fixed: `reply_to_pull_request_review_comment`
with its `comment_id` and one line on what changed, then
`resolve_pull_request_review_thread` with its `thread_id`. Leave a finding you
did not fix open, and say why in your comment.

## If you cannot do it

If the findings contradict each other, or a fix needs a decision you may not
make, do not guess. Call `noop` with the reason, and say that this needs a
person.

Never finish without calling a safe-output tool. Do not change anything under
`.github/`, any `package.json` or lockfile.
