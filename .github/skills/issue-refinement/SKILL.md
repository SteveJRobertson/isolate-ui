---
name: issue-refinement
description: "Refine GitHub issues in the project backlog. Use when: reviewing unrefined issues, grooming the backlog, sprint planning, clarifying acceptance criteria, scoping issues, issue triage. Fetches all issues with GitHub Projects v2 status 'Unrefined' from the current repo and walks through each one interactively, outputting a markdown block per issue to paste into Gemini. Continues asking follow-up questions until all criteria are fully satisfied before moving to the next issue."
argument-hint: 'Optional: specific issue number to refine (e.g. 42)'
---

# Issue Refinement

Refine GitHub issues **one at a time** that have a GitHub Projects v2 status of **Unrefined**. For each issue, output a markdown block to paste into Gemini. Wait for answers, evaluate completeness, and **keep asking follow-up questions until every criterion is fully satisfied** before moving to the next issue.

## When to Use

- Sprint planning / backlog grooming sessions
- Before starting work on an issue
- When asked to "refine issues", "groom the backlog", or "review unrefined items"

## Procedure

### Step 1 — Discover Unrefined Issues

Use the `gh` CLI to find issues with project status "Unrefined". Start by discovering the repo's associated GitHub Projects v2 project:

```bash
gh project list --owner <owner> --format json --limit 10
```

Then attempt to list project items:

```bash
gh project item-list <PROJECT_NUMBER> --owner <owner> --format json --limit 50
```

Filter results for items where the **Status** field equals `"Unrefined"` and the content type is `Issue`.

**Fallback — if the CLI command fails or returns no `status` field**, use the GraphQL API directly:

```bash
gh api graphql -f query='
  query($owner: String!, $number: Int!) {
    user(login: $owner) {
      projectV2(number: $number) {
        items(first: 50) {
          nodes {
            id
            content {
              ... on Issue {
                number
                title
                url
              }
            }
            fieldValues(first: 20) {
              nodes {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  field { ... on ProjectV2SingleSelectField { name } }
                }
              }
            }
          }
        }
      }
    }
  }
' -f owner=<owner> -F number=<PROJECT_NUMBER>
```

Filter for items where the `fieldValues` node with `field.name == "Status"` has `name == "Unrefined"`.

If the user provided an argument (a specific issue number), skip filtering and refine only that issue.

If no Unrefined issues are found, output: _"No issues with project status 'Unrefined' found."_ and stop.

Store the full list internally. Process them **one at a time** — do not fetch or output details for subsequent issues until the current one is fully complete.

### Step 2 — Announce the Queue

Before starting, output a markdown list of all issues to be refined:

```markdown
## Unrefined Issues Queue

- #42 — Some issue title
- #57 — Another issue title
- #61 — Yet another issue title

---

Starting with **#42**. Copy the block below and paste it into Gemini.
```

### Step 3 — Fetch Issue Details (current issue only)

For the **current** issue only, retrieve full details:

```bash
gh issue view <ISSUE_NUMBER> --repo <owner>/<repo>
```

### Step 4 — Assess Completeness and Output Initial Gemini Prompt

Evaluate the issue against the **Refinement Checklist**. For each criterion that is **missing or ambiguous**, include a targeted question. Mark criteria already clearly addressed as "✅ Already defined".

#### Refinement Checklist

| Criterion                | What to look for                                                                | Satisfied when…                                       |
| ------------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **Acceptance Criteria**  | Explicit bullet list or "Given/When/Then" conditions                            | At least 2 concrete, verifiable conditions are listed |
| **Scope Boundary**       | Explicit statement of what is OUT of scope                                      | At least one explicit exclusion is stated             |
| **Nx Projects Affected** | Named Nx project(s) from the workspace (e.g. `react-button`, `utils`, `tokens`) | At least one valid Nx project name is confirmed       |
| **Dependencies**         | References to blocking issues, or explicit "None"                               | A definitive answer is given — "None" is acceptable   |
| **Test Strategy**        | Unit, component, e2e, or manual testing approach                                | A specific testing approach is named                  |

Output the following markdown block for the user to copy into Gemini:

---

```markdown
## Refinement Request: <Issue Title> (#<number>) — Round <N>

### Context

This issue is from the **Isolate UI** project — an Nx monorepo for a React component
library using Panda CSS, Vitest, and Playwright. Components are published as Nx library
projects (e.g. `react-button`, `utils`, `tokens`).

### Issue Body

<full issue body here>

### Existing Labels

<labels, or "None">

### Progress So Far

<on Round 1, write "First pass — no answers yet.">
<on Round 2+, list each criterion and whether it is ✅ satisfied or ❓ still outstanding>

### Questions

Please answer each question as specifically as possible.
Vague answers (e.g. "it depends", "TBD", "nothing else") will result in follow-up questions.

<N>. **<Criterion>** — <targeted question>
<N>. **<Criterion>** — <targeted question>
...

Only include questions for criteria that are not yet satisfied.
```

---

End with:

```markdown
⏸ **Waiting for answers to #<number> — Round <N>.**
Paste the block above into Gemini, then bring the answers back here.
When you return, say: `answers for #<number>` followed by Gemini's response.
```

### Step 5 — Evaluate Answers and Follow Up Until Fully Satisfied

When the user returns with answers, evaluate **every outstanding criterion** against the "Satisfied when…" column.

**For each criterion decide:**

- ✅ **Satisfied** — the answer is specific, concrete, and complete.
- ❓ **Needs follow-up** — the answer is vague, incomplete, contradictory, or raises a new question.

**Examples of insufficient answers and why:**

| Answer                 | Why insufficient      | Better follow-up                                                                                    |
| ---------------------- | --------------------- | --------------------------------------------------------------------------------------------------- |
| "it depends"           | Not concrete          | "What specifically does it depend on? Please give the conditions."                                  |
| "nothing else for now" | No explicit exclusion | "Please name at least one thing explicitly excluded, e.g. 'does not include dark mode support'."    |
| "we'll test it"        | No approach named     | "Which approach: Vitest unit tests, Playwright component tests, e2e tests, or manual verification?" |
| "TBD"                  | Deferred              | "This needs an answer before the issue can be worked on. What is your best current thinking?"       |
| "react-button I think" | Uncertain             | "Please confirm — is `react-button` the only affected project, or are others involved?"             |

**If any criteria remain unsatisfied**, output a new Gemini prompt block (Step 4) with:

- The round number incremented.
- The **Progress So Far** section updated to show what is settled and what is not.
- Only the questions for outstanding criteria.
- Specific feedback on _why_ each previous answer was insufficient, inline with the question.

**Repeat this loop — there is no round limit.** Keep asking until every criterion satisfies its "Satisfied when…" condition.

**If a new answer contradicts a previously accepted answer**, reopen that criterion, flag the contradiction explicitly, and ask for clarification before accepting either answer.

### Step 6 — Output Refined Summary

Once **all 5 criteria are satisfied**, output the final refined summary:

```markdown
## ✅ Refined: <Issue Title> (#<number>) — complete after <N> round(s)

**Acceptance Criteria**

- <criterion 1>
- <criterion 2>

**Out of Scope**

- <item>

**Nx Projects Affected**

- <project>

**Dependencies**

- Blocked by: #<N> (or "None")

**Test Strategy**

- <approach>
```

### Step 7 — Update Project Status

After outputting the summary, discover the project's Status field options and move the item to the option immediately after "Unrefined":

```bash
gh api graphql -f query='
  query($owner: String!, $repo: String!) {
    repository(owner: $owner, name: $repo) {
      projectsV2(first: 10) {
        nodes {
          id
          title
          fields(first: 20) {
            nodes {
              ... on ProjectV2SingleSelectField {
                id
                name
                options { id name }
              }
            }
          }
        }
      }
    }
  }
' -f owner=<owner> -f repo=<repo>
```

Then update the item:

```bash
gh project item-edit \
  --id <ITEM_ID> \
  --field-id <STATUS_FIELD_ID> \
  --project-id <PROJECT_ID> \
  --single-select-option-id <NEXT_STATUS_OPTION_ID>
```

- If there is exactly one status after "Unrefined", use it automatically.
- If there are multiple candidates, output a markdown question asking which to use before updating.
- Confirm the status change: _"✅ #42 status → Ready"_

### Step 8 — Advance to Next Issue

After confirming the status update, immediately output the Gemini prompt block for the next issue (Step 4) without waiting to be asked:

```markdown
---

✅ #<number> complete after <N> round(s).

**Next: #<next-number> — <next title>**

Copy the block below and paste it into Gemini.

<Gemini prompt block for next issue>
```

### Step 9 — Final Summary

After all issues are processed, output a final summary table:

```markdown
## Refinement Session Complete

| Issue   | #    | Rounds | Criteria Added           | New Status |
| ------- | ---- | ------ | ------------------------ | ---------- |
| <title> | #<n> | 2      | AC, Scope, Test Strategy | Ready      |
```

## Edge Cases

- **Issue already fully refined**: all 5 criteria satisfy the "Satisfied when…" conditions → note "✅ Already complete", skip all questions, update status immediately.
- **No project found**: output the error in markdown and stop.
- **`gh` auth failure**: surface the error message in markdown and stop — do not proceed.
- **Argument provided**: if the user ran the skill with a specific issue number, refine only that issue regardless of its current project status.
- **Contradictory answers across rounds**: reopen the affected criterion, flag the contradiction explicitly, and do not mark it satisfied until it is resolved.
