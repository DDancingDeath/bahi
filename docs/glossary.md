# Bahi word list (English ↔ Hindi)

One word per idea, on every screen, in both languages (UX review U-49, U-60). Use these words in
`www/js/i18n/en.js` and `hi.js`; ids, routes, keys and stored values keep their old names. Hindi is
the simple shop Hindi workers speak: short words, English loan words where shops use them (बिल, रेट,
स्टॉक, सेव, लॉगिन), no Latin letters except the names in the last table.

## Money owed

| Idea | English | Hindi | Notes |
|---|---|---|---|
| Money still to come or to go on a bill | **due** / **dues** | **बकाया** | Never "udhaar", "outstanding amount" or "payables" in sentences. |
| The page listing dues | **Outstanding** (page name only) | **बकाया** | In Hindi say "बकाया पेज" when pointing to it, not "उधार पेज". |
| Paying later, as a payment way on a bill (next to Cash, Online) | **Due** | **उधार** | Only for the payment way: "Cash + Online + Due" = "नकद + ऑनलाइन + उधार". |
| Due older than 30 days | **overdue** | **समय निकला** (बकाया) | Same word on Outstanding, Today, Insights and Recurring bills. Not "पुराना बकाया" (पुराना = from the old app) or "देर हो गई". |
| Dues from before the app | **old dues** | **पुराना बकाया** | |
| Lists by age | **To receive, by age** / **To pay, by age** | **लेना बाकी, कितना पुराना** / **देना बाकी, कितना पुराना** | Not "receivables" / "payables". |
| Written off | **written off** (bad debt) | **डूबा उधार** | |

## People

| Idea | English | Hindi | Notes |
|---|---|---|---|
| Buyer on a sale bill | **Customer** | **ग्राहक** | |
| Seller on a purchase bill | **Supplier** | **विक्रेता** | Not "व्यापारी". |
| Either one (a list mixing both) | **Party** | **पार्टी** | e.g. the History table column. |
| Roles | **Owner**, **Manager**, **Member** | **मालिक**, **मैनेजर**, **सदस्य** | Never "admin" for the owner, never "staff" / "स्टाफ" (`i18n-catalogue.test.js`). The **Admin** page keeps its name (एडमिन). |
| Taking a person off the shop | **Remove** (person, access) | **हटाएँ** | Not "Delete user". |

## Items, rates, stock

| Idea | English | Hindi | Notes |
|---|---|---|---|
| The price list page | **Rates** | **रेट** | |
| One entry on it (names + three rate lists) | **item** — **Add item**, **Edit item** | **आइटम** — आइटम जोड़ें, आइटम बदलें | Not "Add rate" for a whole item. |
| Goods in general | **stock**, **goods** | **स्टॉक**, **माल** | |
| Stock value per kg (average purchase cost) | **Avg cost ₹…/kg** | **औसत लागत ₹…/kg** | Not "Rate" on Stock. |
| Weight | **kg** | **kg** | Owner decision: "kg" in Hindi too (`hindi-kg-unit.test.js`), never किलो. |
| Sack | **packet** | **बोरी** | |

## Actions and states

| Idea | English | Hindi | Notes |
|---|---|---|---|
| Sign in / out | **Log in** / **Log out** | **लॉगिन** / **लॉगआउट** | Not "Login" as a verb, not "logout". |
| Store | **Save** / **Saved** | **सेव करें** / **सेव हुआ** | Shared settings: "Saved for everyone" = "सभी के लिए सेव हुआ". |
| Undo a bill | **Cancel** (void) | **रद्द करें** | |
| Put the whole bill in one payment box | **Fill** | **सब यहाँ** | Not "पूरा" (reads as "full"). |
| Anomaly checked, nothing wrong | **Looks right** | **सही है** | |
| Anomaly checked and the bill corrected | **I corrected it** / **Corrected** | **मैंने सुधारा** / **सुधारा गया** | |
| The "More" tab | **More** | **बाकी सब** | "और" alone reads as "and". |
| Bills that look wrong (Anomalies page) | **Anomalies** | **गड़बड़ियाँ** | Only for this page. |
| App errors (Diagnostics) | **Errors** | **गलतियाँ** / **ऐप की गलतियाँ** | Not "गड़बड़ियाँ", so the two pages differ. |
| Months | Jan … Dec | जनवरी … दिसंबर | Full names in Hindi ("14 नवंबर"); the short forms with "॰" read like a degree sign. |

## Error messages

A failed save or load says what did not happen, then one next step from `utils/friendly-error.js`
(`msg.error.*`): check the internet, ask the owner for access, log in again, try later, or try again.
The server's English text is never shown; it stays in the console log that Diagnostics records.

## Latin letters allowed in Hindi

Bahi, happa, UPI, PDF, CSV, JSON, Excel, WhatsApp, Google, GPay, browser and phone names (Chrome,
Edge, Safari, iPhone, iPad), units (kg, MB, GB, ms), "v" before a version number, and "DELETE" (the
word to type). `i18n-catalogue.test.js` fails on any other Latin word in `hi.js`. Item, party and
tenant names stay as the user typed them.
