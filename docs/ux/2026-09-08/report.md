# Hearth UX pass, 2026-09-08

Target: http://127.0.0.1:18080, disposable published container with synthetic data.
Image: sha256:9f16bb8aa0133fa84e5d9a1b1d0119460bbc358920e4702d963a82d3fae49463
Revision: 26cb0ba7f834baf4e3d1ed54bd9dffe44061c3d2
Scope: empty-home setup, rooms, panels/circuits, floorplan, maintenance; desktop and 390px mobile.
Browser: Chrome for Testing 151.0.7922.76, agent-browser 0.33.2.
Method: browser-first exploration against packaged frontend and real API. No application source inspection or production data.

## Summary

Seven medium-severity findings; no critical or high-severity failures observed in the exercised flows. The main priorities are retaining drafts and navigation context, then reducing the effort to map and inspect a breaker on a phone.

## Remediation tracking

[Planning tracker #98](https://github.com/R055LE/hearth/issues/98) owns current status. This report is a dated observation, not proof that a finding still exists after subsequent releases. Documentation does not close the remediation issues.

| Finding | Remediation issue | Proposed sequence |
| --- | --- | --- |
| ISSUE-001 | [#99: Improve phone navigation and room-control touch targets](https://github.com/R055LE/hearth/issues/99) | Phone workflow |
| ISSUE-002 | [#100: Offer a simple rectangular-room creation flow](https://github.com/R055LE/hearth/issues/100) | Room entry |
| ISSUE-003 | [#101: Preserve maintenance drafts when switching sections](https://github.com/R055LE/hearth/issues/101) | First: draft preservation |
| ISSUE-004 | [#102: Keep selected-point breaker details visible on phones](https://github.com/R055LE/hearth/issues/102) | Phone workflow |
| ISSUE-005 | [#103: Offer a direct circuit-walk action for unmapped breakers](https://github.com/R055LE/hearth/issues/103) | Phone workflow |
| ISSUE-006 | [#104: Preserve the active section across browser refresh](https://github.com/R055LE/hearth/issues/104) | First: section restoration |
| ISSUE-007 | [#105: Fix selected-breaker text contrast in light mode](https://github.com/R055LE/hearth/issues/105) | Independent small fix |

Each implementation issue has acceptance and validation criteria. Use one implementation branch/worktree/PR per issue. Draft preservation and navigation restoration share a behavior decision; settle it before implementing both. Phone controls, point details and the breaker handoff should use consistent actions and focus behavior. The color fix can proceed independently.

The empty-home room handoff, maintenance lifecycle questions and untested scenarios below remain follow-up triage in the planning tracker, not additional confirmed defects.

## Findings

### ISSUE-001: Phone navigation and room controls are cramped

Remediation: [#99](https://github.com/R055LE/hearth/issues/99).

Severity: medium. Category: visual / usability. Static evidence; video N/A.

At 390×844 all four navigation buttons measure 21px tall. The room builder also uses closely packed small inputs, turn menus, and removal buttons. Maintenance wraps onto a second navigation row. These controls demand precise taps during an inherently mobile task.

Evidence: [empty panels](screenshots/panels-empty-mobile.png), [four-wall room form](screenshots/room-four-walls.png). Browser DOM measurements: Floorplan 71.58×21; Rooms 58.22×21; Panels & circuits 123.42×21; Maintenance 92.33×21.

Suggested acceptance: navigation and primary field actions have comfortable roughly 44px touch areas; phone navigation has an intentional layout; wall actions have enough separation to avoid accidental removal. This is a usability finding, not a claim of WCAG failure from size alone.

### ISSUE-002: Adding an ordinary room starts with a technical geometry workflow

Remediation: [#100](https://github.com/R055LE/hearth/issues/100).

Severity: medium. Category: UX. Static form evidence; video N/A.

Rooms > Add room exposes X/Y feet, four arrow controls, per-wall feet/inches, and turn direction. There is no simple rectangular-room entry. Creating a 12×10 Kitchen required entering 12, 10, 12, 10 as four separate walls. The finished form is about 1,500px tall at 390px width, with preview and Create room below the wall list. The initial instruction is only “Add at least 3 walls”; after the first wall it becomes “Gap: 144.0in.”

Evidence: [initial form](screenshots/add-room-mobile.png), [completed rectangular draft](screenshots/room-four-walls.png).

Suggested acceptance: offer a rectangle with length and width as the common path, keep measured wall-walk geometry available, and explain initial direction/turns and closure in ordinary language. Keep the preview useful while entering measurements. This is a refinement recommendation; wall entry itself successfully created the room.

### ISSUE-003: Switching sections silently discards a maintenance draft

Remediation: [#101](https://github.com/R055LE/hearth/issues/101).

Severity: medium. Category: functional / UX. Reproduced twice with synthetic input.
Video: [draft loss](videos/issue-003-draft-loss.webm). Video initialization reloads the app; the reproduction starts after returning to Maintenance.

1. Maintenance > Add task. Enter “Replace HVAC filter” and notes. [Filled draft](screenshots/issue-003-step-1.png).
2. Click Rooms, as someone checking the available room might do. No unsaved-changes prompt appears. [Rooms](screenshots/issue-003-step-2.png).
3. Return to Maintenance > Add task. The task and notes are blank. [Lost draft](screenshots/issue-003-result.png).

Expected: retain the draft when switching sections, or explicitly offer to discard it before leaving. Cancel should remain an intentional discard. This lost unsaved input, not an existing saved record.

### ISSUE-004: A selected outlet's useful answer is below the phone viewport

Remediation: [#102](https://github.com/R055LE/hearth/issues/102).

Severity: medium. Category: visual / UX. Static layout evidence; video N/A.

At 390×844, with a 12×10 Kitchen and a selected outlet, the map occupies about 466px in height. The detail card begins around y=732, and the room, circuit and panel label are below the initial viewport. Much of the map is empty margin around a room approximately 200×160px. The selected point also visually covers part of the room name.

Evidence: [selected outlet full page](screenshots/point-details-mobile.png).

Suggested acceptance: after selecting a point, show its breaker/panel answer in view, using a compact detail area or deliberate scroll/focus behavior. Fit the map to the phone's usable space and keep point markers from overwhelming a small room. The current data and point selection are correct.

### ISSUE-005: A new breaker has no direct next step into mapping

Remediation: [#103](https://github.com/R055LE/hearth/issues/103).

Severity: medium. Category: UX. Static directory evidence; video N/A.

After creating Main panel and breaker 1, its card shows “Unmapped” and “Needs verification.” “View breaker 1 on floorplan” is disabled; the other card actions are Edit and Delete. There is no “Map this breaker” or “Start circuit walk” handoff. The user must know to switch to Floorplan > Walk circuit and select the circuit there.

Evidence: [new breaker at phone width](screenshots/panel-mobile.png).

Suggested acceptance: an unmapped breaker offers a direct action that opens circuit walk with that breaker selected. Keep status text, but use it to guide the next task. The current workaround successfully mapped a point.

### ISSUE-006: Refreshing loses the current section

Remediation: [#104](https://github.com/R055LE/hearth/issues/104).

Severity: medium. Category: navigation / UX. Reproduced twice.
Video: [refresh resets navigation](videos/issue-006-refresh.webm).

1. Open Maintenance with the saved recurring task visible. The address remains the root URL. [Before refresh](screenshots/issue-006-step-1.png).
2. Refresh the browser. Hearth opens Floorplan instead of Maintenance. [After refresh](screenshots/issue-006-result.png).

Expected: the active section has a durable URL or equivalent restoration so refresh retains location. Saved records remain intact; the problem is losing the user's place. A section URL would also enable bookmarks. Browser Back/Forward was not separately exercised.

### ISSUE-007: Selected-breaker text has low contrast in light mode

Remediation: [#105](https://github.com/R055LE/hearth/issues/105).

Severity: medium. Category: accessibility / visual. Static evidence; video N/A.

In explicit light mode, select the Counter outlet and inspect the selected Breaker 1 below the detail card. It uses small bold orange text (#f97316) on white. Axe reports 2.8:1 contrast against its expected 4.5:1 threshold for this text. The light screenshot confirms the white background. The same audit's earlier dark-mode background assumption was unreliable, so this finding is limited to light mode.

Evidence: [light-mode selected breaker](screenshots/issue-007-light-contrast.png), [axe result](floorplan-light-a11y.json).

Suggested acceptance: use a darker selected-text color in light mode, retaining a separate visible selection treatment, and verify both color schemes.

## What worked and limits

- Created a 12×10 room, a panel, a circuit, and a labeled outlet through the packaged UI and real API.
- Circuit walk saved the outlet and exposed point details afterward.
- Canceling an edited point label restored the original visible label. API traffic was not instrumented to prove a zero-write cancellation invariant.
- Completing a 90-day recurring task advanced the due date from September 8 to December 7 and retained the completed occurrence in History.
- Checked desktop at 1440×1000 and phone at 390×844. The phone floorplan and saved Rooms view measured 390px document width, matching the viewport. This is not a whole-app overflow guarantee.
- No page errors or console messages appeared in the checks taken during the pass.
- Maintenance axe audit: zero violations, one incomplete contrast group. Selected floorplan: one contrast violation and one incomplete group. These are scoped automated checks, not full accessibility certification.
- Maintenance has an explicit Save completion step. Completion-history correction and task retirement remain worth a separate lifecycle review; they are not counted as reproduced defects here.
- Empty-home “Add a room” navigates to Rooms and requires a second “Add room” click. Kept as a minor onboarding observation rather than inflating the issue count.
- Limited synthetic data: one room, panel, circuit, point, and recurring task. Large homes, multiple floors/panels, dense point clusters, every edit/delete path, browser Back/Forward, network failure, and cross-browser behavior were not covered.
- The exploratory pass made no application changes or production mutations. This document preserves that dated baseline; remediation status belongs in the linked GitHub issues.

## Priority

Seven findings: 0 critical, 0 high, 7 medium, 0 low. Severity describes the current friction; proposed solutions remain recommendations.

1. Preserve drafts and section location (003, 006).
2. Make the main phone journeys direct: comfortable controls, visible point answers, and a breaker-to-walk handoff (001, 004, 005).
3. Add a simple room-entry path (002).
4. Correct light-mode selected text (007), a small independent fix.

## Additional captured evidence

The finding sections link the primary evidence. These supplementary captures and audit results preserve the rest of the review without turning incomplete checks into findings:

- [floorplan-a11y.json](floorplan-a11y.json)
- [maintenance-a11y.json](maintenance-a11y.json)
- [empty-floorplan.png](screenshots/empty-floorplan.png)
- [floorplan-light-mobile.png](screenshots/floorplan-light-mobile.png)
- [floorplan-loaded-mobile.png](screenshots/floorplan-loaded-mobile.png)
- [floorplan-mobile.png](screenshots/floorplan-mobile.png)
- [maintenance-desktop.png](screenshots/maintenance-desktop.png)
- [maintenance-mobile.png](screenshots/maintenance-mobile.png)
- [point-cancel-mobile.png](screenshots/point-cancel-mobile.png)
- [point-desktop.png](screenshots/point-desktop.png)
- [rooms-light-mobile.png](screenshots/rooms-light-mobile.png)
- [walk-first-point.png](screenshots/walk-first-point.png)
