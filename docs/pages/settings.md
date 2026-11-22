# Settings, Admin, App health

Part of the [owner guide](../owner-guide.md) (one file per page). Hindi: [settings.hi.md](settings.hi.md). The codes in brackets are spec IDs in [calculations.md](../calculations.md).

- **Settings** is a short list: **Language** (English or Hindi; saved for the person, so it follows them to any
  phone, with this phone's choice as the fallback), **Account** (your name with Save, email, Change password, Switch user, Log out; Switch user checks for changes
  not sent yet like Log out, then shows an empty login card for the next person),
  for the owner and managers **Lock this phone** (off until a 4–6 digit lock number is set; after 2–30 minutes without use
  the app asks for it, also after the app is closed and opened again; it stays on this phone as a salted hash; forgetting
  it means logging out; while it is on, the Android app hides its screen from recent apps and screenshots), then one row per group. A row opens its group on its own page; **Back** (or the phone's
  back gesture) returns to the list. Rows you may not open are not shown.
- **Settings › Appearance** (everyone): Light, Dark or System (follows the device; saved on this device) and the
  **theme**: Modern Minimal (the default), Vintage, Classic, Nordic, Glass, Material, Fluent, Nature, Premium, Dark, Midnight or Cyberpunk. Vintage, Classic
  and Premium use serif titles and figures for English; Hindi stays in the usual Devanagari letters. Each card shows a small Billing in its theme, and on a computer a larger live preview sits beside the gallery. Tapping a theme previews it across the app;
  **Apply** saves it on this device and **Cancel** (or leaving Appearance) goes back. Dark, Midnight and Cyberpunk are always dark.
  **Reset to default** goes back to Modern Minimal and System. Printed bills look the same in every theme. Also item names
  in Hindi and, on phones, swiping between pages.
- **Settings › Printing & receipts** (everyone): Bluetooth printer (switch on, status, show the bill before printing,
  saved and found printers, Scan, Test print, Disconnect) and **Printed bill**: the bottom line, the bill's QR code,
  the bill language, print darkness and logo are the same on every phone; the owner, or a manager allowed in Roles &
  access, changes them (others see them). The printer and paper width stay on each phone. A saved printer that is
  in use but not connected (after the app restarts) has **Connect**. The same Bluetooth printer controls open from
  the printer button next to the bell on Billing ([billing.md](billing.md)).
- **Settings › Billing tools** (everyone): Voice billing and Beep after listening (per device), and **Photo of weights**
  (on or off for everyone; only the owner switches it).
- **Settings › Aadhat** (owner and managers; a manager changes them only when Roles & access allows): business name
  and details, UPI ID (name@handle, checked by the app and the rules), labour rate and package weight, bill checks, bill numbers and this phone's code, opening stock.
  Each change saves for everyone when you leave the box ("Saved for everyone at …" under the title); the UPI ID in
  WhatsApp payment reminders is the shop's, the same on every phone (a UPI ID typed on one phone before is moved there
  once). Only "Enable automatic labour charges by default" stays on each phone.
- **Settings › Rentals** (Rentals owner and managers): defaults for new leases and the tenant page header. (The Simple / Advanced
  switch for the Rentals page is gone: Rentals has one view for everyone.)
- **Settings › Team** (owner only), the one place for people: **People** (Show people: Waiting to join with a role
  picker and Approve / Reject, everyone's role (**Edit role** offers Member / Manager / Owner: an owner can make an approved
  person owner after a confirmation, demote another owner or step down, but there is always at least one owner;
  a pending person is approved first), Reset password, Remove from shop and Restore) and **Add a worker
  without email** (name, username and an 8–12 digit pin as the password; such an account is always a Member, the rules refuse another role: the worker signs in with the username; the account's
  email is made up under a reserved domain no mail reaches, so a forgotten pin means removing the account and making a
  new one), **Roles & access** (pick Manager or Member, then one row per permission; edit window in days; Save for
  everyone; members don't see profit, stock value, purchase rates or past cash days unless the owner turns them on)
  and **Rentals roles**.
- **Settings › Help & about** (everyone): install the app, App updates (version, What's new, share, download page),
  About, Usage on this phone, **Notifications** (this phone only: **Phone notifications** on or off, then Bell updates, To do reminders,
  Udhaar summary (owner, managers), Rent due (Rentals) and Backup check (owner) one by one, the daily summary time
  (9:30 am) and **Send test notification**. The phone asks to allow notifications only when you switch them on or send a
  test; if it was refused, the card says where to allow them in the phone's settings. In the Android app reminders come at
  their time even with the app closed; in the browser only while the app is open. docs/notifications.md); in the Android app, **Crash reports** (off
  unless this phone's user turns it on: crashes and freezes then go to the shop's Firebase with the
  phone's details; the app adds no names or amounts, but an error message can hold text; docs/error-reporting.md says exactly what is sent).
- **Admin › Users**: counts, a link to Settings › Team (where approving, roles, password resets and
  **Remove from shop** now are; Restore brings a removed person back as a pending registration) and Activity by person.
- **Admin › Data › Bill dues: stored in one place** (owner): **Check bills** reads every bill once
  and says how many older bills keep their due in an old place; **Store the due** writes it in the one
  place the app uses. No amount on any screen changes (BILL-PAY); check that a recent backup is good first.
- **Anomalies**: bills that look wrong (a possible duplicate bill, a rate far off,
  a big cash gap…) and each mismatch the daily number checks found ("Number check: …", on
  its bill, item or cash day); tap "Looks right" on each, or ⋯ for Open, Correct rate and "I corrected it".
- **Diagnostics › Number checks**: the always-true checks run on this phone's data
  (bill split, payments, dates, dues, drawer, stock).
- **Diagnostics › Audit logs**: CSV (in English) or Print / PDF of the entries listed;
  **Errors**: Export report (the errors with names, numbers and secrets removed, plus this
  phone's status) to send to whoever fixes the app. Both are written in the audit log.
- **Diagnostics › Status › Test error reports** (owner only): **Send a test error** records a test error
  through the app's error reports; it shows under Diagnostics › Errors. In the Android app with crash reports
  switched on it also goes to Crashlytics (an error that did not close the app), and **Send a test crash**
  closes the app on purpose after a confirm. With crash reports off, or not set up in that version of the app,
  it says so and offers no test crash (docs/error-reporting.md, "Check that reports arrive").
