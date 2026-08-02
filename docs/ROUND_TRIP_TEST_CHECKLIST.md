# Round-trip test checklist

Manual proving-out for the activity-trades, drift and batch-split work
(commits `7a238f0`..`7acc4b0`). Written 2026-07-29.

Automated tests cover the pure logic and the routes. What they cannot cover is
the loop through MS Project and back — which is the whole point of this feature.
That is what this checklist is for.

Work top to bottom; later sections depend on earlier ones.

---

## 0. Before you start — two things will block you

**A. Your project has no finalized progress update.** `buildExport` refuses
without one ("No finalized progress to export yet"). Nothing below works until
this is done.

- [ ] Progress Update → create an update → mark at least one activity → **Finalize**

**B. The file on disk no longer matches what was imported.** The export checks
that the file you upload hashes to the same bytes as the current import, and
`BSW Regional ED Schedule DRAFT v6 ALT P2 Overlap.xml` in the repo has been
re-saved since. Export will reject it with "doesn't match the current imported
schedule".

Two ways out — pick one:

- **Find the exact file you originally imported** and use that. Nothing is lost.
- **Re-import the current file.** Simplest, and it re-aligns the hash. The cost:
  your 15 accepted splits belong to the old import chain and are superseded, so
  you re-accept them. That is now *one click per coarse scope* instead of one per
  activity, so re-doing it is itself a test of section 1.

- [ ] Decide which route, and note that trade assignments are per-project and
      survive either way — only the split history is superseded

> **Do not use the Reset button for this.** It wipes trade assignments too (15 of
> them), and the roster only refreshes on next launch from Connect. Reset is for
> starting a project over, not for re-aligning a file.

---

## 1. Batch splits

Granularity page.

- [ ] Pick a coarse scope with several flagged instances (`MEP OH Rough-In` has 8).
      **Dismiss one instance first** — you need it to prove the next assertion.
- [ ] Click **Accept** on any remaining instance. The dialog should name the
      number of activities and the total tasks it will create
      (e.g. "Replace 7 activities … 28 tasks in total").
- [ ] Confirm. **Expect:** every flagged instance of that scope is replaced at
      once, and the flagged count drops by exactly the number the dialog named.
- [ ] **The dismissed one is still there, unsplit.** If it was split, dismissals
      are being ignored — stop and report it.
- [ ] Project page → the import line should show **one** new import, not seven.
      Several imports from one accept means the batching didn't take.
- [ ] The finer activities appear in the schedule view with the coarse one gone.

**Known and expected:** the finer activities all inherit the coarse activity's
dates and duration, at 0%. Re-sequencing them is a job for MS Project.

**Worth forcing if you can:** a schedule where two activities *of the same coarse
scope* are linked to each other (`MEP OH Rough-In` L1 → L2). Your current
schedule has none, so this path has never run on real data — only in tests. After
splitting, no relationship should reference the replaced activities, and the two
sets of replacements should be linked to each other.

## 2. Trade on the schedule view

Project page. Requires disciplines mapped and partners assigned (Trades page).

- [ ] Expand an activity whose scope is mapped → **Discipline** and **Trade
      partner** appear in the detail.
- [ ] Expand one that is *not* mapped → neither line appears. Blank is correct;
      "Unassigned" or "null" is a bug.
- [ ] Type a partner name into the search box (e.g. `Amber`) → the list filters
      to that trade's activities.
- [ ] Type a discipline fragment (e.g. `ELECTRICAL`) → filters too.
- [ ] Use the **All trades** dropdown → filters by discipline. It should list only
      disciplines present in this schedule (15 for your project).
- [ ] Switch the sort between **WBS** and **Start**, then filter again. The WBS
      view is grouped and the others are flat, and they run different code paths —
      a filter that works in one and not the other is the bug to watch for.

## 3. Export carries the columns

Already proven once on a generated file. This repeats it through the real UI.

- [ ] Export to MS Project → download the file
- [ ] Open in MS Project, insert columns **Text2** and **Text3**
- [ ] **Expect:** they read *Discipline* and *Trade Partner*, populated
- [ ] Your existing **Text1 / Phoenix ID** column is untouched, with its original
      values. If ours landed on Text1 and clobbered Phoenix ID, stop — that is the
      serious failure in this feature.
- [ ] Activities with no mapped trade have both cells blank

## 4. The drift round trip — the real end-to-end

This is the one nothing automated has ever proven. Everything above is a
prerequisite for it.

- [ ] In MS Project, on the exported file, **change one activity's Trade Partner
      cell** to a different company that IS on this project's Connect roster
      (e.g. change an electrical activity to another real partner). Save as XML.
- [ ] Import that file back into the tool
- [ ] Trades page → **Changed in MS Project** tab shows a row: the discipline, the
      file's value, and yours, with a count of affected activities
- [ ] Click **Keep this one** → the row disappears
- [ ] Re-import the same file → **it stays gone.** If it comes back, the dismissal
      isn't keyed the way it should be.
- [ ] Now change that *same* activity to a **third** partner in MS Project,
      re-export, re-import → **it flags again.** This is the property the whole
      dismissal design turns on: a ruling about one name must not silence a
      different edit later.
- [ ] Click **Accept file** → Trade Assignment tab shows the discipline reassigned
      to the file's partner
- [ ] Re-import once more → nothing flagged, because the tool and file now agree

- [ ] **The refusal path:** in MS Project, set a Trade Partner cell to a company
      that is NOT on the Connect roster (type a made-up name). Re-export,
      re-import, open the drift tab, click **Accept file**. **Expect a clear
      refusal naming that company** — not a silent failure, and not a new partner
      invented in the assignment table.

## 5. Edge cases worth forcing

- [ ] **Two different edits, one discipline.** Change two activities of the same
      discipline to two *different* partners. Expect **two** rows, not one — each
      is its own decision.
- [ ] **Discipline column edited.** Change a *Discipline* cell in MS Project and
      re-import. Expect **nothing flagged** — only Trade Partner is compared, by
      design. If it flags, something is comparing more than intended.
- [ ] **A blank Trade Partner cell** in MS Project → not flagged. Absence is not
      disagreement.

## 6. Regression spot-checks

Things earlier in the app that this work touched.

- [ ] Task Naming still lists unmapped names, and Save still maps them
- [ ] **Unmap** on a mapped name returns it to the review list
- [ ] Trades → Unmapped Activities is still the tab that opens first when
      anything is unmapped
- [ ] A discipline with exactly one covering partner is still pre-selected, with
      the "selected for you, Save to confirm" note
- [ ] Progress Update → create, save entries, finalize still works
- [ ] Export still injects actuals and standardized names, not just the new
      columns

---

## If something fails

Note which checklist line, what you saw, and whether the file or the tool was
"wrong". For anything in section 4, keep the XML you imported — the drift
comparison is driven entirely by the `Trade Partner` value in that file, and
having it makes the failure reproducible in a test rather than a description.
