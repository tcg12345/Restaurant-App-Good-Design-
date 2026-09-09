# Meal calendar

Open `/calendar` from the desktop sidebar or the calendar shortcut on the phone home screen.

- Responsive Month, Day and List views with Liquid Glass navigation. Selecting a date animates the month down to its selected week and focuses that day’s timeline. Show month restores the grid. Swipe to change months/weeks, use arrows to change days, or tap the month heading to jump to a month/year. Date buttons support arrow keys and Home/End.
- Dining/cooking filters, month-wide plan search, optional cancelled plans, event-count dots and a shortcut to the next planned meal. New plans open their day and clear active search/type filters. Loading, empty and filtered states are distinct; transitions respect reduced-motion settings.
- Restaurant search, saved restaurants, saved recipes and free-text plans.
- A two-step event editor with date shortcuts and an inline calendar, time/duration presets, party-size controls, tappable reservation status and collapsible optional details. Custom values remain available; selections survive moving back and switching plan types. The action bar remains visible while the form scrolls and adapts to the keyboard.
- The editor slides in and can be pulled down from its handle or header. Small pulls spring back; long pulls and quick downward flicks dismiss after the exit animation. Form scrolling stays native, saving blocks dismissal, and reduced-motion preferences are respected.
- Reservation status, booking reference, address, people/servings, duration and notes.
- Edit/reschedule, overlapping-plan notices, cancellation/restoration, cooking completion and deletion.
- Calendar export as an ICS file on web; native file sharing on iOS.

Signed-in plans use the private `calendar_plans` table. RLS restricts every operation to the owner; account deletion cascades to plans. Successful writes are cached per account for offline reading. Failed network writes leave the editor open with the draft intact. Guests use separate device-local storage; their plans do not migrate to an account automatically.

Times are entered and displayed in the current device time zone and stored as UTC instants. A dining plan becomes eligible for a review after its end time, for 14 days. On app launch/foreground, one eligible visit is shown after other overlays close. Users can rate it, snooze 24 hours, skip the review, or cancel the visit. Matching ratings for the planned visit date suppress the prompt. The existing rating flow receives that date and treats earlier restaurant ratings as separate visits.

Push notifications and actual reservation booking are intentionally deferred. Marking a reservation booked only records a booking made elsewhere.

The migration `20260908142249_calendar_plans.sql` is applied to the configured Supabase project. Its local version matches the remote migration history. It creates a new table and timestamp trigger, without changing existing tables.

Validation:

```sh
npm run test -- src/pages/CalendarPage.test.tsx src/components/calendar/usePlanSheetMotion.test.tsx src/components/calendar/PlanDatePicker.test.tsx src/components/calendar/PlanEditor.test.tsx src/components/calendar/VisitReviewPrompt.test.tsx src/contexts/CalendarContext.test.tsx src/lib/calendar.test.ts src/lib/calendar-security.test.ts src/components/RatingFlow.test.ts src/lib/app-routes.test.ts
npm run build
```

Tests exercise calendar boundaries, review eligibility and snoozing, rating handoff, linked recipe/restaurant saves, failed save retries, storage failures, account isolation, owner CRUD/RLS and ICS escaping. Browser checks cover desktop, 390px phone layout, persistent plan creation and reservation details. Native export and native foreground events require an iOS device check before an App Store release.
