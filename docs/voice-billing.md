# Voice billing (#81, #131, #498)

Status: in the app, **off by default**: the whole bill by voice (#498: party, lines, bag
weights, rate, payment, labour, note, day) through one check sheet, a name mic in the
Customer field (Purchase and Retail sale), hold-to-talk, and a spoken readback (#81 A1–A3). The web header
(#266) and the Android recogniser (#267) are in, so it runs in Chrome and in the Android
app; #498 fixed the Android microphone flow (see "Android app").

## Whole bill by voice (#498)

**Hold to talk.** Press and hold the 🎤 beside Rate, speak, let go. While held the mic is
marked and the words heard so far show under it ("Hearing: …"; the Android recogniser and
Chrome both give partial words). Let go off the mic (more than 48 px away) or have the press
cancelled by the system, and nothing is used ("Let go off the mic: nothing used"). A quick tap
(under 350 ms) listens once, to the first pause, as before; so does a key or TalkBack (a click
with no press). The press uses pointer events (`www/js/ui/voice-mic.js`, `bindHold`): no text
selection, long-press menu or scrolling starts from the mic (`touch-action: none`). Android's
recogniser ends at a pause by itself; while the mic is still held it is started again and the
parts are joined, so a long bill with pauses is one hold.

**Say it in any order**, in one hold or several (`www/js/utils/voice-bill-parse.js`). Hindi
or English, in either script:

| Part | Say | Goes to |
|---|---|---|
| Party | "Ramesh se", "from Ramesh", "supplier Ramesh", "customer Ramesh", "Ramesh ko", "Ramesh ke liye", "ग्राहक का नाम रमेश", "रमेश से" | Supplier / Customer (matched to known parties, below) |
| Lines | "gehun 10 kilo 25 rupaye, chawal 5 kilo 30", "wheat 10 kg 24 aur rice 5 kg 30" (VB-1 below; "aur", "and", "phir", commas and pauses split lines; Hindi item names said in Latin letters, "gehun" = गेहूं, are matched) | Ticked lines are added through Add to bill |
| Bag weights | "wheat bags 23, 24.5, 22 at 25", "gehun bori 50, 52 rate 24" (also katta, packet, vajan) | One line with each bag as a weight chip (sum shown) |
| Rate | "rate 26", "bhav 26" | The last line heard, else the Rate box |
| Payment | "cash 500", "500 cash", "nakad 500", "online 300", "UPI / PhonePe / GPay / Paytm 300", "udhaar 200" | Cash / Online / Due boxes |
| Rest | "baaki udhaar", "rest due", "baad mein", "udhaar" alone; "baaki cash", "baaki online" | Rest → due (the page's own logic), or the rest in that box |
| Whole bill | "pura cash", "full cash", "sab online", "pura udhaar" | As ticking that box's Fill |
| Labour (Purchase) | "labour 60", "majdoori 60", "hammali 60" | The Labour box (as typed) |
| Labour per bag | "labour 6 per bag", "labour 6 bori ka" | ₹6 × the bill's heavy bags, in the Labour box |
| Labour off / on | "labour band", "labour charge band", "labour off", "labour nahi", "no labour", "मज़दूरी बंद"; "labour on" | The Labour switch |
| Note | "note GPay name Mohan" (everything after "note" / "नोट", words kept as said) | Notes (opened) |
| Day | "aaj", "kal", "yesterday", "parso", "3 din pehle" | Date, only for the owner on a new bill (the Change date rule) within the allowed days; otherwise the sheet says it was not changed |
| Undo | "undo", "wapas", "वापस" | With the sheet open: takes the last hold off the sheet; else Undo voice |

Labour on a Retail sale is not used (the sheet says so). Labour is the bill's Labour box
(`manualLaborCharges`, marked as typed so the auto value doesn't replace it); the shared
per-bag rate in Settings is never changed by voice.

**The check sheet.** One sheet shows everything understood: what was heard (each hold), the
party with its match, each line (item, kg — a bag list as "23 + 24.5 + 22 = 69.5" —, rate,
amount), the rate for the line, labour, the payment legs, rest / whole bill, the note and the
day, and "Lines heard: ₹…". Every part can be unticked or changed (Correct for a line, a box
for each amount, the note text, a pick list for the party). Unclear parts are marked (a line
missing its weight or rate, words that fit nowhere: "Not understood: …", more than one
party fitting, a day that can't be used). **Hold to add more** in the sheet listens again and
adds to it; a later party, payment leg, labour or day replaces the earlier one, lines are
added, notes joined. Readback (if on) reads each hold's summary. Only **Fill bill** puts it on
the page, in order: party (with input/change events, so the due line and suggestions follow),
lines (one line alone with nothing else fills the entry boxes as before; otherwise the ticked
lines are added through Add to bill, with its checks), the rate, labour, the payment (then
Rest → due), the note and the day. **Nothing is saved**; Undo voice takes all of it back.

**Party matching** (`rankPartyMatches` in `utils/party-match.js`). The known parties are the
names on the bills loaded on this phone (the same list as the name suggestions, #139). A name
matches in any script and spelling (`looseWord`: "रमेश" = "ramesh"), honorifics left out
("Ramesh bhai" ~ "Ramesh"), a part of a longer name, or a small mishearing. The sheet uses a
party only when exactly one fits exactly and no other is close; otherwise the pick list starts
on "Use '<as said>'" and is marked, and the user chooses.

**Name mic.** A small 🎤 inside the Customer field (Purchase and Retail sale), beside the contact button
(44+ px, en/hi label; only while voice billing is on). A tap listens once for a name ("Ramesh
bhai se" → "Ramesh Bhai"), then lists the closest known parties (with what is open on them),
"Use '<as said>'" and, where the phone can pick contacts, "Pick from phone contacts". Nothing
is picked for the user. A pick fills the field as typing would. Phone contacts are not read in
bulk: the contact picker shows only the one contact chosen.

## Android app (#498)

What was checked: rc14 bundles `@capacitor-community/speech-recognition` 7.0.1
(`assets/capacitor.plugins.json`), its manifest has `RECORD_AUDIO` and the
`android.speech.RecognitionService` query, and in the app `voiceEngine()` is `'native'`
(Capacitor's bridge lists the plugin). What was wrong or fragile:

- The recogniser was one-shot (`partialResults: false`): Android ends it at the first short
  pause, so a whole bill ("gehun 10 kilo … [pause] … 25") was cut off, and nothing showed while
  listening. Hold-to-talk uses `partialResults: true` (live words, and Android's dictation
  mode), starts again after a pause while held, and ends on release.
- The plugin's `stop()` never answers on Android: it is never awaited (the last words come as
  a `partialResults` event, with a 2.5 s limit).
- The microphone is asked for on first use (`checkPermissions` → `requestPermissions`); the
  press that shows the system dialog does not listen, and says "Microphone allowed. Now hold
  the mic and speak." Refused: "Microphone permission is off. To use voice, allow it in the
  phone's Settings › Apps › this app › Permissions › Microphone. Or type." (en/hi). No
  recogniser on the phone (`available()` false): a message to turn on Google's speech services.
- The mic is never hidden while voice is on; a device with no speech engine shows the mic and a
  tap says why (Settings keeps the switch usable to turn voice off).

Needs a new APK (the app bundles `www/`).

## What it does

Settings › **Voice billing** (per device, off until switched on). When on, Billing shows a 🎤
button on the purchase and the retail sale form (and the name mic). One tap (or hold, above):

1. listens (the language follows the app: Hindi `hi-IN`, English `en-IN`);
2. reads the party and each line's item, weight and rate from what was
   heard (`www/js/utils/voice-parse.js`, spec VB-1 in [calculations.md](calculations.md)),
   and the rest of the bill (above);
3. shows the check sheet: what was heard, the customer, and the item / weight (kg) /
   rate (₹) found for each line, or "not heard", and reads it back aloud;
4. only after **Fill bill**: one line alone goes in the form's Item, Rate and Weight boxes;
   several lines are added to the bill, each ticked line through the form's own
   Add to Bill (with its bag-weight and rate checks), in spoken order; the
   customer's name, if ticked, goes in the Customer box.

Voice never saves. One line: the user checks it, taps Add to Bill, then Save, as
when typing. Several lines: the user unticks any wrong line in the dialog (a line
missing its weight or rate can't be ticked), then checks the bill and saves. If a
check stops a line (the user taps Fix), that line stays in the form, the later
lines are not added, and the message says how many were. Voice refuses to switch
the item while weights for another item are already entered (they would move to
the spoken item), and adds no lines while a weight is typed or entered but not
added. Nothing heard is stored, logged or sent anywhere by the app (a phrase not\nunderstood is counted on the phone by a hash only, see tier B below).

**Several lines (A2).** "गेहूं 50 kg 25 रुपये, सरसों 30 kg 55 रुपये": lines are split
at "aur" / "और" / "and" / "phir" / "फिर", a comma, a full stop or "।", or between two
items said with nothing between them (cut where both sides read best as a line,
"10 kg aloo 30 rupees 5 kg pyaaz 25"). A part that names no item stays with the
line before it, so "one hundred and fifty kg" and "aloo 10 kilo aur 30 rupaye" stay
one line.

**Customer (A3).** "customer" / "ग्राहक" / "naam" / "नाम" / "party" / "kisan" and then
up to three words ("ग्राहक का नाम रमेश", "customer name is Mohan Lal"), ending at a
number, an item, a unit or a line break. A name already in the form's customer
list is used with its spelling. The dialog says which typed name it would replace;
untick it to keep that one. Said alone ("customer Suresh"), only the name is filled.

**Readback (A1).** The dialog reads back what was understood with the browser's
`speechSynthesis` in `hi-IN` or `en-IN` ("Customer Ramesh. Wheat, 50 kg, 25 rupees
per kg"; in Hindi with the Hindi item name), and stops when the dialog closes, so
the next 🎤 doesn't hear it. Its **Read aloud** switch mutes it on this device
(`aadhat.voiceReadback`; on by default). It uses only a voice on the device
(`localService`), never a network voice such as Chrome's "Google …" voices, which
would send the text (names, items, amounts) to a server. With no such voice for the
language, or no `speechSynthesis` at all (the Android System WebView often has none
or lists no voices), nothing is read aloud, the switch is hidden and the dialog works
the same.

Understood: digits (also Devanagari ०–९), Hindi number words 1–99, सौ / hundred,
हज़ार / thousand, आधा / half (½), पाव / quarter (¼), डेढ़ (1½), ढाई (2½), साढ़े (+½), सवा (+¼),
पौने (−¼; "sava kilo" = 1.25 kg), English number words; a final "do" / "दो" ("give") is not 2;
weight words kg / kilo (also in Devanagari), and grams as kg (500 gram = 0.5 kg,
1 kilo 500 gram = 1.5 kg); rupee words and "का" / "ka" after a rate, "at" / "₹" /
"rate" / "भाव" before it. Numbers without such a word are weight first, then rate.
"per kilo" / "प्रति kg" and "kilo ka 30" make a rate. Items match by English or Hindi name
(archived items never). A number with another unit (quintal, bori, bag, packet…)
or said as a total ("for 300", "10 kilo ke 300") is never used, and then the
line's unmarked numbers and a rupee-only rate are not guessed either: the dialog
warns and the user types them (also "300 rupaye ke 10 kilo", "10 kilo 300 mein",
"60 rupaye mein 2 kilo"; and
"100 rupaye ka chawal" with no weight, an amount to buy). More
numbers than a weight and a rate are flagged too, and so is a rate more than 3×
above or below every rate kept for that item (likely a total).

## Tier B (#131): correct, transcript, undo, beep, missed phrases

All on the phone: no new service, permission or Firestore read.

- **Correct a line.** Each line in the check dialog has a **Correct** button (keyboard
  reachable, `aria-expanded`) that opens boxes for its item, weight (kg) and rate,
  filled with what was heard. A change shows in the row at once; a line that was
  missing its weight or rate becomes tickable once both are typed. OK uses the
  corrected values (still through the form's own checks).
- **Transcript.** Under 🎤 a line (`role="status"`, `aria-live="polite"`) shows
  "Listening…", then what was heard and what came of it (check it, cancelled, filled,
  lines added, not understood, undone). It stays until the next listen; it is shown
  only while voice billing is on and is never stored.
- **Undo.** Each voice change on a form (lines added, the customer, item, rate and
  weight boxes) is kept on that form, the last 10 (`utils/voice-undo.js`).
  **Undo voice** under 🎤, or saying only "undo" / "wapas" / "pichla hatao" /
  "वापस" / "पिछला हटाओ" / "ग़लत" (`isUndoCommand`), takes back the last one: it
  removes the lines it added and puts the boxes back, but only what is still as voice
  left it. A line removed or edited since, or a box typed over, is kept, and the
  message says so. It waits (and says so) while the bill is saving, and puts the
  item and rate back only when no weights are entered and no bill line is being
  edited (those weights would be billed as the old item). Saving or clearing the
  bill ends its voice changes, so Undo is never offered across bills. A voice
  result is not applied while the bill is saving either.
- **Beep.** Settings › Billing tools › Voice billing › **Beep after listening** (per device,
  `aadhat.voiceBeep`, off by default): a short high tone when something was
  understood, a low one when not (Web Audio, made on the phone).
- **Missed phrases (C13).** A sentence in which nothing was understood counts
  `voice.miss` and `voice.miss.<8 hex>` in the local usage counters of #136
  (Settings › Help & about › Usage on this phone; 90 days, never sent). The 8 hex digits are the
  start of an HMAC-SHA-256 (Web Crypto) of the lower-cased words, keyed with a random
  salt made once on this phone (`happa.voicePhraseSalt`, never exported or sent), so a
  phrase that keeps failing shows as one repeated code on this phone, and the code
  can't be turned back into the words; the words themselves are never kept (Q75). `voice.undo` and
  `voice.edit` count undos and corrected lines.

## Findings (validated 1 Nov 2026)

**Where the "staging" code is.** In the archived private repo
`DDancingDeath/AadhatManagementApp-staging` (read only), `main` branch:
`www/js/modules/voice-billing.js` (802 lines), `docs/VOICE_BILLING_V2.md`, tests
`www/js/__tests__/voice-billing.test.js` and `voice-settings.test.js`, mic buttons
in `www/templates/billing.html`. Commits: V1 `56e230f`, V2 Tier A `d827e1c` (A5
settings), `ca19a4f` (A1 spoken readback), `25ed551` (A2 several items), `3462d6f`
(A3 customer name). Nothing of it was ever in the production repos: in happa (all
143 branches) and the old `AadhatManagementApp` (all 49 branches)
`git log --all -S SpeechRecognition` and `-S RECORD_AUDIO` find nothing.

**How it worked.** The browser Web Speech API (`webkitSpeechRecognition`, `hi-IN`)
plus `speechSynthesis` for the readback; a regex parser. It filled the form **and
auto-added** (weight chip, and in a several-item sentence each line to the bill),
with "add to bill" / "जोड़ दो" voice commands. A4 (Hindi 11–99) and A6 (confirm
before commit) were planned, not built.

**It never worked in the Android app.** The Android System WebView (what Capacitor
runs in) has no working Web Speech API: `webkitSpeechRecognition` is missing or
does nothing there (Chromium issue 41172064; it works only in the Chrome browser).
Staging's manifest also never had `RECORD_AUDIO` (its C12 item was open). So the
app needs a native recogniser: `@capacitor-community/speech-recognition` (MIT,
v7 for Capacitor 7) wraps Android's `SpeechRecognizer`; its own manifest adds
`RECORD_AUDIO` and the `android.speech.RecognitionService` `<queries>` entry, and
it asks for the microphone at runtime.

**Hindi.** Yes: both Chrome (`hi-IN`) and Android's recogniser (Google) handle
Hindi and mixed Hindi-English well; Google usually writes numbers as digits.

**Offline.** Chrome's Web Speech API sends the audio to Google's servers: online
only. Android's recogniser works offline only if the phone has Google's offline
speech pack for that language (Settings › Google › Voice › Offline speech
recognition); otherwise it needs the internet too. The app shows "Voice needs the
internet here" when the engine says so; typing always works.

**Privacy.** The audio goes to the phone's or browser's speech service (usually
Google), as with the keyboard's mic. The app keeps no audio and no text; the
setting's hint says so.

**Security header.** #198 (#89) first sent `Permissions-Policy: microphone=()` on
the web, which blocked the microphone for the site. #266 changed it to
`microphone=(self)` on the app site only (`firebase.json`; frames, other sites and
the redirect-only sites still get none), and [security.md](security.md) says why.
The app still reads the policy (`document.featurePolicy`, `www/js/ui/voice-mic.js`):
where a policy blocks the microphone, voice counts as not available (the setting is
greyed out with "Not available on this device"). The header does not reach the
Android app (it serves `www/` from the APK).

## What is still needed

| Change | Why | State |
|---|---|---|
| `Permissions-Policy: microphone=(self)` on the app site, `docs/security.md` updated | The web / PWA (Chrome) can use the mic for voice | Done (#266, 1 Nov) |
| `@capacitor-community/speech-recognition` 7 + `RECORD_AUDIO` in the Android manifest | The Android app gets a recogniser (the WebView has none) | Done (#267, 1 Nov); in APKs built since |
| A test on a real phone in the Android app: Hindi and English, a noisy shop, with and without internet, the microphone prompt, several lines in one sentence, a customer's name, whether the readback speaks | #81's "works in the Android WebView with the mic prompt" item; nothing above was tried on a phone | Owner, open |

Both changes are safe while the setting is off: no page asks for the microphone
unless the user switches voice on and taps 🎤.

## Not built yet (from #81 and #131)

- #81: the wake word (A0, needs a Picovoice key), Hindi number words above 99
  except hundreds; a native text-to-speech plugin if the Android app turns out to
  have no voice for the readback.
- #131: continuous dictation, editing a row by voice ("line 2 rate 30"), and the
  Android App Actions shortcut ("Bill banao", a native `shortcuts.xml` change). Undo,
  correcting a line in the dialog, the transcript strip, the beep and counting missed
  phrases are in (above).
- Quintal (100 kg) as a weight word; rates per quintal.

Recommendation: test on a real phone with the shop's own items (Hindi and English,
noisy shop, with and without internet, one and several lines, the readback) before
anyone relies on it. Keep the check-before-fill step: voice fills or adds only
after OK, and a person saves.
