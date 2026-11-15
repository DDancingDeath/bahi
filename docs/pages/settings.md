# Settings, Admin, App health

Part of the [owner guide](../owner-guide.md) (one file per page). Hindi: [settings.hi.md](settings.hi.md). The codes in brackets are spec IDs in [calculations.md](../calculations.md).

- **Settings** is a short list: **Language** (English or Hindi), **Account** (your name with Save, email, Change
  password, Log out), then one row per group. A row opens its group on its own page; **Back** (or the phone's
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
  access, changes them (others see them). The printer and paper width stay on each phone.
- **Settings › Billing tools** (everyone): Voice billing and Beep after listening (per device), and **Photo of weights**
  (on or off for everyone; only the owner switches it).
- **Settings › Aadhat** (owner and managers; a manager changes them only when Roles & access allows): business name
  and details, UPI ID, labour rate and package weight, bill checks, bill numbers and this phone's code, opening stock.
- **Settings › Rentals** (Rentals owner and managers): defaults for new leases and the tenant page header.
- **Settings › Team** (owner only): **Roles & access** (what each role may see, edit window in days; Save for everyone)
  and **People**.
- **Settings › Help & about** (everyone): install the app, App updates (version, What's new, share, download page),
  About, Usage on this phone, desktop notifications; in the Android app, **Crash reports** (off
  unless this phone's user turns it on: crashes and freezes then go to the shop's Firebase with the
  phone's details; the app adds no names or amounts, but an error message can hold text; docs/error-reporting.md says exactly what is sent).
- **Admin › Users**: approve, change role, Reset Password (emails the person a
  link), Delete (removes access; Restore brings them back as a pending
  registration).
- **Admin › Data › Bill dues: stored in one place** (owner): **Check bills** reads every bill once
  and says how many older bills keep their due in an old place; **Store the due** writes it in the one
  place the app uses. No amount on any screen changes (BILL-PAY); check that a recent backup is good first.
- **Anomalies**: bills that look wrong (a possible duplicate bill, a rate far off,
  a big cash gap…) and each mismatch the daily number checks found ("Number check: …", on
  its bill, item or cash day); tap "Mark OK" or "Mark fixed" on each.
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
