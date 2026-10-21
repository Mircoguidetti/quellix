# How agents work on Quellix

Several Claude Code sessions build Quellix in parallel. A coordinator (another Claude session working with the founder) assigns the work and reviews it. All communication goes through GitHub, never through files in the repo.

## Your assignment

You get **one GitHub issue**. It is your full spec. Re-read it whenever you are unsure.

## Rules

0. **Language:** everything you write is in English: code, comments, UI copy, docs, commits, issue comments and PRs, even if your prompt is in another language.
0b. **Work autonomously:** your plan is approved the moment you post it, unless the coordinator objects in the issue. Do not stop to ask the person in your chat for confirmation between milestones; keep going until the PR is open. The only reasons to stop: a decision that cannot be undone, a missing secret or account, or a coordinator comment telling you to stop. Questions go in the issue (`QUESTION:`), not in the chat.
1. **Branch:** work on `agent/<area>` (the issue says which), created from the latest `main`. Never commit to `main`.
2. **Scope:** change only the folder the issue gives you. Never edit `packages/contracts/`, `supabase/migrations/` or another agent's folder. If you need a change there, ask in the issue.
3. **Start:** post a first comment on the issue with your plan (5-10 bullet points).
4. **Progress:** post a short comment at each milestone: what is done, what is next, test status.
5. **Questions:** post a comment starting with `QUESTION:`. Do not wait idle: continue with the parts that do not depend on the answer, and check the issue comments again before your next milestone.
6. **Reading replies:** before each milestone, read the new comments on your issue:
   `gh api repos/Mircoguidetti/quellix/issues/<N>/comments --jq '.[] | {user: .user.login, created_at, body}'`
7. **Done:** push your branch and open a pull request into `main` whose body starts with `Closes #<N>` and contains the final report (template below). Do not merge it yourself.
8. **Review:** opening the PR is not the end. After opening it, check the PR comments every few minutes (`gh api repos/Mircoguidetti/quellix/issues/<PR>/comments`). When the coordinator requests changes, make them, push to the same branch and reply on the PR. You are done only when the PR is merged or the coordinator writes `APPROVED, no further changes`.
9. **Commits:** small and focused. Every commit message ends with:
   ```
   Co-Authored-By: Claude <noreply@anthropic.com>
   ```
10. **Quality bar:** lint, type checks and tests of your folder pass locally before every push. GitHub Actions may be unavailable; local is what counts. No secrets in git, ever.

## Final report template (PR body)

```
Closes #<N>

## What works
## Commands run and results
## Stubbed or not done, and why
## Proposed changes to contracts or migrations (exact diff)
## Env vars / accounts the founder must set up
## Suggested next steps
```

## Using the GitHub API

GraphQL may be unavailable in some environments; prefer the REST API through `gh api`:
- comment: `gh api repos/Mircoguidetti/quellix/issues/<N>/comments -f body="..."`
- open PR: `gh api repos/Mircoguidetti/quellix/pulls -f title="..." -f head="agent/<area>" -f base="main" -f body="..."`
