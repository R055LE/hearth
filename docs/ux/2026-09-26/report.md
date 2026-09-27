# Representative floorplan journeys

Source: [Hearth issue #139](https://github.com/R055LE/hearth/issues/139), under [roadmap #138](https://github.com/R055LE/hearth/issues/138).

## Setup

Walked a local packaged build from Hearth `main` at `3ab4766` against its real API and a disposable SQLite database. No production or private home data was used. The synthetic home has two floors, nine initial rooms (including irregular shapes), two panels, five circuits, 19 mapped points, and three active room-linked maintenance tasks. Two more rooms were created through the app during the room journey.

Desktop viewport: 1440 × 900. Phone viewport: 390 × 844. Browser: agent-browser 0.33.2. The page had no horizontal overflow at 390px (`scrollWidth` 390).

## Journey 1: add a room beside existing rooms, then correct its size and position

### Observed path

On desktop, Floorplan > Add room showed a 10 × 10 ft draft and the instruction to click the map to place it. I entered `Sunroom`, changed the dimensions to 12 × 9 ft, and used the optional X/Y fields to set the origin to (30, 0), flush with the Living Room's right edge. Save closed the form, added the room to the map, and left it selected. The form and map preview showed the draft before Save.

At 390px, I entered `Porch` at 8 × 10 ft and tapped beside Sunroom. The tap produced a draft at X=40.6, Y=1, overlapping Sunroom by about 1.4 ft. The optional precise-position controls let me correct it to (42, 0), after which the preview touched Sunroom's edge. Save added Porch and kept it selected. The form fits below the floorplan, so the user scrolls between map and details rather than losing the draft.

The tap is useful for rough placement, but it does not communicate exact adjacency. The numeric correction path is present and usable. This is reproduced interaction friction, not a save defect. I did not observe a draft loss or an accidental API write before Save.

### Evidence

- [Desktop starting map](screenshots/desktop-floorplan.png)
- [Desktop map before adding the room](screenshots/journey-1-desktop-start.png)
- [Desktop add-room form](screenshots/journey-1-add-room-form.png)
- [Desktop precise-position controls](screenshots/journey-1-fine-position-open.png)
- [Desktop corrected preview](screenshots/journey-1-room-preview.png)
- [Desktop saved room](screenshots/journey-1-saved-desktop.png)
- [Phone add-room form](screenshots/journey-1-phone-add-form.png)
- [Phone map before adding the room](screenshots/journey-1-phone-start.png)
- [Phone tap preview](screenshots/journey-1-phone-preview.png)
- [Phone corrected preview](screenshots/journey-1-phone-corrected.png)
- [Phone saved room](screenshots/journey-1-saved-phone.png)
- [Walkthrough recording](videos/journey-1-room-creation.webm)

## Journey 2: move a mapped point and look up its breaker

### Observed path

The three Kitchen counter markers overlap. A pointer tap in their shared area selected `Counter east`; a pointer attempt aimed at `Counter middle` was covered by the overlapping marker. Keyboard focus plus Enter selected `Counter middle` by its accessible name. Its detail card showed the panel, breaker, label, room, verified description, and sticker text.

Move point opened a draft with room, circuit, kind, label, and X/Y fields, and asked the user to tap the map. A map tap changed the preview to (9, 6.9). Before Save the API still had the original (5.2, 5) coordinates. Cancel left those coordinates unchanged. Repeating the move and saving changed the API coordinates once; the point remained linked to Kitchen and breaker 2.

At 390px, tapping the overlapping Sofa markers selected `Sofa east`. Hearth scrolled the selected-point card into view, where breaker 4 was visible. Move point kept the map above the form. Saving left the selected point and breaker details in the card; `Back to map` returned to the map.

The tap-to-move draft and explicit Save/Cancel behaved as expected. Reproduced friction: overlapping markers do not let a pointer user choose the intended point reliably. Keyboard selection by label works. On phone, showing point details requires a scroll away from the map, with an explicit return action.

### Evidence

- [Keyboard-selected Counter middle](screenshots/journey-2-keyboard-selection.png)
- [Pointer tap selected Counter east](screenshots/journey-2-pointer-cluster-selection.png)
- [Desktop starting state](screenshots/journey-2-desktop-start.png)
- [Desktop move form](screenshots/journey-2-move-mode-desktop.png)
- [Desktop move draft](screenshots/journey-2-move-preview.png)
- [Desktop draft before Save](screenshots/journey-2-desktop-save-preview.png)
- [Desktop cancelled draft](screenshots/journey-2-cancelled-desktop.png)
- [Desktop saved move](screenshots/journey-2-saved-desktop.png)
- [Phone point details and breaker](screenshots/journey-2-phone-point-selected.png)
- [Phone starting map](screenshots/journey-2-phone-start.png)
- [Phone move form](screenshots/journey-2-phone-move-form.png)
- [Phone move preview](screenshots/journey-2-phone-move-preview.png)
- [Phone saved point details](screenshots/journey-2-phone-saved.png)
- [Walkthrough recording](videos/journey-2-point-relocation.webm)

## Journey 3: find every point on a breaker across floors

### Observed path

On Main, selecting Breaker 6 highlighted the Entry and Living Room smoke alarms. Switching to Upper cleared the breaker selection and removed the highlight. Breaker 6 remained in the circuit list; selecting it again highlighted the Primary Bedroom and Landing alarms. The same reset happened at 390px. There is no cross-floor point list or count in this view, so the user has to reselect the breaker on each floor and visually inspect the map. The map fits the whole floor but has no visible pan or zoom controls; selection only changes the marker highlight and circuit label.

### Evidence

- [Desktop Main points](screenshots/journey-3-breaker-main-desktop.png)
- [Desktop Upper after selection cleared](screenshots/journey-3-breaker-upper-desktop.png)
- [Desktop Upper after reselecting](screenshots/journey-3-breaker-upper-selected-desktop.png)
- [Phone Main points](screenshots/journey-3-phone-breaker-main.png)
- [Phone Upper starting map](screenshots/journey-3-phone-upper-start.png)
- [Phone Upper after selection cleared](screenshots/journey-3-phone-upper-unselected.png)
- [Phone Upper after reselecting](screenshots/journey-3-phone-breaker-upper.png)
- [Walkthrough recording](videos/journey-3-breaker-across-floors.webm)

## Journey 4: find and complete a room's maintenance task

### Observed path

Selecting Living Room on Floorplan showed the room name and `Edit room on map`; it showed no linked tasks. I switched to Maintenance and found `Replace HVAC filter` by its displayed room name. The list groups tasks as Overdue or Upcoming and shows each room. Complete opened an inline date draft defaulted to 2026-09-26. Cancel left the API due date and completion list unchanged. Save recorded the completion and advanced the recurring task to 2026-12-25.

At 390px, selecting Primary Bedroom and switching to Maintenance showed `Test smoke alarms` under Overdue with its room name. Completing it recorded 2026-09-26 and advanced its due date to 2027-03-25. Returning to Floorplan reset the floor to Main and cleared room selection. The task itself remains visible in Maintenance, but its map context is lost across the section change.

The list and completion controls fit at 390px with no horizontal overflow. Reproduced friction: finding work for a selected room requires changing sections and scanning the global task list; returning loses the floor and selected room. Save/Cancel behavior is explicit and worked against the real API.

### Evidence

- [Desktop selected room](screenshots/journey-4-room-selected-desktop.png)
- [Desktop Maintenance list](screenshots/journey-4-maintenance-list-desktop.png)
- [Desktop completion draft](screenshots/journey-4-completion-form-desktop.png)
- [Desktop cancelled completion](screenshots/journey-4-completion-cancelled.png)
- [Desktop completed task](screenshots/journey-4-completed-desktop.png)
- [Phone selected room](screenshots/journey-4-phone-room-selected.png)
- [Phone floorplan before room selection](screenshots/journey-4-phone-floorplan-start.png)
- [Phone Upper map](screenshots/journey-4-phone-upper.png)
- [Phone Maintenance list](screenshots/journey-4-maintenance-list-phone.png)
- [Phone completion draft](screenshots/journey-4-completion-form-phone.png)
- [Phone completed task](screenshots/journey-4-completed-phone.png)
- [Phone after returning to Floorplan](screenshots/journey-4-return-floorplan-phone.png)
- [Walkthrough recording](videos/journey-4-room-maintenance.webm)

## Proposed interaction rules

These are design decisions based on the reproduced journeys. Pointer drag, pan, zoom, resize, and failed-save behavior are not in the current map, so those parts are proposals rather than observed behavior.

1. **Selection is safe by default.** A click or tap selects a room or point and changes no geometry. A focused map object is labeled; Enter selects it. When point hit areas overlap, tapping the cluster opens a chooser with each point's label and room instead of selecting whichever marker is on top.
2. **Pan has a clear target.** In browse mode, dragging empty map space pans. Wheel or trackpad gestures zoom, with visible Fit, zoom-in, and zoom-out controls. On touch, a two-finger gesture pans or pinches to zoom; a one-finger tap selects. Selection stays visible when the view changes. A keyboard user can reach Fit and zoom controls and tab to named objects.
3. **Object movement requires an explicit mode.** Choose Move for a selected room or point before dragging it. While that mode is active, dragging the selected object changes only a visible draft; dragging empty space does not move another object. Touch uses the same explicit mode and one-finger object drag. Keyboard users keep precise X/Y fields and can nudge the draft with arrow keys.
4. **Drawing and resizing are explicit modes too.** Add room enters rectangle-drawing mode; a pointer or one-finger drag sets a rough rectangle. Resize enters a separate mode with visible handles. Exact dimensions and X/Y remain available for mouse, touch, and keyboard users. A move gesture never resizes, and a resize gesture never pans.
5. **Save is the only commit.** Selecting, tapping, dragging, drawing, and resizing update only a draft. Save makes the API write; Cancel or Escape discards it. A failed write keeps the draft, relationships, and an actionable error visible. Changing floor or section with a draft asks whether to Save, Discard, or Stay. A view change without a draft preserves the selected room, point, or breaker.
6. **Keep cross-floor and room context.** A selected breaker remains selected when the floor changes, with points highlighted on the new floor. Find results identify point and room names plus floor. A selected room exposes its active due/overdue work; completing a task refreshes that room summary and preserves the floor and selection.

## Target journeys after the proposed changes

- **Add or correct a room:** Floorplan > Add room > drag a rough rectangle beside existing rooms > enter exact length/width and position > Save. On a phone, one-finger drag draws while Add mode is active; the same numeric fields correct it. Keyboard uses the fields and Save/Cancel. The preview stays visible beside neighboring rooms until commit.
- **Move or resize a room:** Select the room > choose Move or Resize > drag the selected rectangle or its resize handle > review dimensions and mapped points > Save. The two modes keep object movement, resizing, and viewport panning distinct. Touch uses one finger in the active mode; keyboard uses the same exact position and dimension fields.
- **Navigate a floor:** Fit shows all current geometry. Zoom and pan bring dense areas into view without clearing the selected room, point, or breaker. A mouse or trackpad pans the empty canvas and uses wheel/pinch for zoom; touch uses two fingers for viewport movement, while one finger selects or acts only in an explicit edit mode. Keyboard users reach Fit/zoom controls and named map objects with Tab and Enter.
- **Move a point:** Select by its label, using a cluster chooser when markers overlap > Move > drag the selected point within the floorplan > review room and breaker > Save. Tap and keyboard paths use the same draft and exact fields. Cancel restores the original position.
- **Find a breaker across floors:** Search/select Breaker 6 > see all four smoke alarms grouped by floor > choose a point to switch floors and focus it. The selected breaker stays active; no reselection is needed after changing floors.
- **Complete room maintenance:** Select a room > see its due tasks and dates in the room context > open the task and Save or Cancel completion > see the refreshed due date and a route to history. On return, the same floor and room remain selected.

## Scope recommendation

The observations confirm the order in #138; they do not justify a sequence change. Keep viewport controls (#140) ahead of cross-floor find (#141), since a result needs a stable way to focus its geometry. The task findings confirm that room maintenance (#148) is a meaningful independent slice after this discovery. No implementation behavior was changed here. Save failure was not induced; its recovery rule above follows the roadmap's shared acceptance criteria.
