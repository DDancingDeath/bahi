# Cash (the drawer)

Part of the [owner guide](../owner-guide.md) (one file per page). Hindi: [cash.hi.md](cash.hi.md). The codes in brackets are spec IDs in [calculations.md](../calculations.md).

Only cash counts here, for one day's cash session.

| On screen | How it is worked out |
|---|---|
| Cash sales, purchases (C1, C2) | Cash paid at save on that day's sales / purchases. |
| Expenses (C3) | That day's **cash** expenses, business and personal. |
| Due received / paid (C4, C5) | Cash part of that day's due payments. |
| Deposits (C6) | Cash added to the drawer. |
| Expected cash (C7) | Opening + cash sales + due received + deposits − cash purchases − due paid − expenses. |
| Today's cash (C7) | A 2×2 grid, as in the old app: Opening, **Cash in** (cash sales + due received, the same as Today's "Cash In"), Cash out and **Expected cash** (opening + cash added + cash in − cash out: what should be in the drawer), the last one tinted and bold. Cash added shows when there is some (Expected cash then takes the whole last row). A closed day shows the day's figures with Expected cash, and one line under the grid: "Counted ₹9,250 · ₹62 short" (red), "· ₹40 extra" (amber) or "· matches" (green, within ₹1); there is no line before the count. |
| Difference (C8) | Counted cash − expected: short or extra. Within ₹1 it matches. |
| Counted cash (C9) | The last counted closing; it is the drawer part of Net worth. |
| Open for N hours (C10) | When today's cash has been open 14 hours or more, Close cash says so with the time it was opened. |

One session per day: the second phone joins it. Opening needs internet. A closed
day can't be reopened; a day closed without a count shows "Not counted" and can
be counted later. A day with a change still on this phone (offline) shows
"Not sent yet" in the list, then "Saved" once the server has it.

There is one Cash screen: Today › Cash (Money's cash drawer link opens it too). Closing needs the
internet, because the expected cash must include every phone's entries. Offline, Close cash keeps the
count (and note) on this phone and says so; when the internet is back the count is put back in the
fields with a note, and one tap on Close cash finishes the day.
