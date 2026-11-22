/**
 * Voice billing (#81 A1–A3) with a stand-in recogniser and speech engine (no microphone):
 * one sentence with a customer and several lines shows the check dialog, reads it back,
 * lets a line be unticked and adds only the ticked lines to the bill; the name goes in the
 * Customer box; nothing is saved. English on a purchase, Hindi on a retail sale.
 * Screenshots of the dialog go to the test's output folder (and the report).
 */
const { test, expect, login, showTab, expectToast } = require('./support/app');
const { listDocs, deleteAll } = require('./support/emulator');

const KILO = '\u0915\u093F\u0932\u094B';

async function shot(page, testInfo, name) {
    const path = testInfo.outputPath(`${testInfo.project.name}-${name}.png`);
    await page.waitForTimeout(500); // the dialog's opening transition
    await page.screenshot({ path });
    await testInfo.attach(name, { path, contentType: 'image/png' });
}

/** Voice on; the recogniser "hears" window.__voiceSaid; the speech engine records what it says. */
async function fakeSpeech(page) {
    await page.addInitScript(() => {
        localStorage.setItem('aadhat.voiceBilling', '1');
        window.__voiceSaid = [];
        window.__spoken = [];
        class FakeRecognition {
            start() {
                setTimeout(() => {
                    this.onresult?.({ resultIndex: 0, results: [window.__voiceSaid.map(transcript => ({ transcript }))] });
                    this.onend?.();
                }, 50);
            }
            abort() {}
            stop() {}
        }
        window.SpeechRecognition = FakeRecognition;
        window.webkitSpeechRecognition = FakeRecognition;
        const synth = {
            speak: (u) => window.__spoken.push({ text: u.text, lang: u.lang }),
            cancel: () => {},
            getVoices: () => [{ lang: 'en-IN', name: 'en', localService: true }, { lang: 'hi-IN', name: 'hi', localService: true }]
        };
        Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
        window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    });
}

const say = (page, text) => page.evaluate((t) => { window.__voiceSaid = [t]; }, text);
const spoken = (page) => page.evaluate(() => window.__spoken.slice());

test.beforeEach(() => deleteAll('dev_autoSaves'));
test.afterEach(() => deleteAll('dev_autoSaves'));

test('one sentence: customer and several lines, read back, a line unticked, the rest added, nothing saved (#81)', async ({ page, problems }, testInfo) => {
    await fakeSpeech(page);
    await login(page, 'staff');
    await showTab(page, 'billing');
    await page.click('#purchaseModeBtn');
    const dialog = page.locator('#modalMessage #voiceCheck');

    // ---- English, purchase ----
    await say(page, 'customer ramesh kumar, wheat 50 kg 22 rupees, mustard 30 kg 55 rupees aur rice 10 kg');
    await page.click('#voiceMicPurchase');
    await expect(dialog).toBeVisible();
    await expect(page.locator('#toast')).not.toHaveClass(/\bshow\b/);
    await expect(dialog).toContainText('Ramesh Kumar');
    await expect(dialog.locator('[data-voice-line]')).toHaveCount(3);
    await expect(dialog.locator('[data-voice-line="0"]')).toBeChecked();
    await expect(dialog.locator('[data-voice-line="2"]')).toBeDisabled();
    await expect.poll(() => spoken(page)).toEqual([{
        text: 'Customer Ramesh Kumar. Wheat, 50 kg, 22 rupees per kg. Mustard, 30 kg, 55 rupees per kg. Rice, 10 kg',
        lang: 'en-IN'
    }]);
    await shot(page, testInfo, 'voice-check-en');

    // Mute is kept on this device; untick Mustard; OK adds Wheat only
    await dialog.locator('#voiceReadback').uncheck();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('aadhat.voiceReadback'))).toBe('0');
    await dialog.locator('[data-voice-line="1"]').uncheck();
    await page.click('#modalConfirm');
    await expectToast(page, /Lines added to the bill: 1\./);
    await expect(page.locator('#customerName')).toHaveValue('Ramesh Kumar');
    await expect(page.locator('#billTable tbody')).toContainText('Wheat');
    await expect(page.locator('#billTable tbody')).not.toContainText('Mustard');

    // ---- Hindi, retail sale: the readback switched back on in the dialog speaks again ----
    await page.evaluate(() => window.app.i18n.setLang('hi'));
    await page.click('#saleModeBtn');
    await say(page, `ग्राहक रमेश, गेहूँ 5 ${KILO} 26 रुपये, सरसों 3 ${KILO} 62 रुपये`);
    await page.click('#voiceMicSale');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-voice-line]')).toHaveCount(2);
    await expect(dialog.locator('#voiceReadback')).not.toBeChecked();
    expect(await spoken(page)).toHaveLength(1);
    await dialog.locator('#voiceReadback').check();
    await expect.poll(async () => (await spoken(page)).slice(1)).toEqual([{
        text: 'ग्राहक रमेश. गेहूं, 5 kg, 26 रुपये प्रति kg. सरसों, 3 kg, 62 रुपये प्रति kg',
        lang: 'hi-IN'
    }]);
    await shot(page, testInfo, 'voice-check-hi');
    await page.click('#modalConfirm');
    await expect(page.locator('#saleTotal')).toHaveText('316');
    await expect(page.locator('#saleCustomerName')).toHaveValue('रमेश');

    // Voice never saves
    const saved = [...await listDocs('dev_purchases'), ...await listDocs('dev_retailSales')];
    expect(saved.filter(b => ['Ramesh Kumar', 'रमेश'].includes(b.customerName))).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
    await page.evaluate(() => window.app.i18n.setLang('en'));
});

test('tier B: correct a line, the transcript, undo by keyboard and by voice, English and Hindi (#131)', async ({ page, problems }) => {
    await fakeSpeech(page);
    await login(page, 'staff');
    await showTab(page, 'billing');
    await page.click('#purchaseModeBtn');
    const dialog = page.locator('#modalMessage #voiceCheck');
    const strip = page.locator('#voiceTranscriptPurchase');
    const bill = page.locator('#billTable tbody');
    await expect(strip).toHaveAttribute('aria-live', 'polite');

    // ---- English, purchase: the second line's rate was not heard; Correct fills it ----
    await say(page, 'wheat 50 kg 22 rupees, mustard 30 kg');
    await page.click('#voiceMicPurchase');
    await expect(dialog).toBeVisible();
    await expect(strip).toHaveText('Heard: “wheat 50 kg 22 rupees, mustard 30 kg”. Check it and tap Fill bill.');
    await expect(dialog.locator('[data-voice-line="1"]')).toBeDisabled();
    await dialog.locator('[data-voice-edit-btn="1"]').click();
    await expect(dialog.locator('[data-voice-edit-btn="1"]')).toHaveAttribute('aria-expanded', 'true');
    await dialog.locator('[data-voice-edit="1"] [data-voice-field="rate"]').fill('55');
    await expect(dialog.locator('[data-voice-line="1"]')).toBeChecked();
    await page.click('#modalConfirm');
    await expectToast(page, /Lines added to the bill: 2\./);
    await expect(bill).toContainText('Mustard');
    await expect(strip).toContainText('Lines added to the bill: 2.');

    // Undo voice from the keyboard takes both lines off
    const undo = page.locator('#voiceUndoPurchase');
    await expect(undo).toBeVisible();
    await undo.focus();
    await page.keyboard.press('Enter');
    await expect(bill).not.toContainText('Mustard');
    await expect(bill).not.toContainText('Wheat');
    await expect(undo).toBeHidden();
    await expect(strip).toHaveText('Last voice change undone.');

    // ---- Hindi, retail sale: one line fills the form, "वापस" said takes it back ----
    await page.evaluate(() => window.app.i18n.setLang('hi'));
    await page.click('#saleModeBtn');
    const saleStrip = page.locator('#voiceTranscriptSale');
    await say(page, `गेहूँ 5 ${KILO} 26 रुपये`);
    await page.click('#voiceMicSale');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.voice-edit-btn')).toHaveText('सुधारें');
    await page.click('#modalConfirm');
    await expect(page.locator('#saleWeight')).toHaveValue('5');
    await expect(page.locator('#voiceUndoSale')).toBeVisible();
    await say(page, 'वापस');
    await page.click('#voiceMicSale');
    await expect(page.locator('#saleWeight')).toHaveValue('');
    await expect(saleStrip).toHaveText('सुना: “वापस”। आवाज़ से किया पिछला बदलाव वापस लिया।');
    await expect(page.locator('#voiceUndoSale')).toBeHidden();

    expect(problems.pageErrors).toEqual([]);
    await page.evaluate(() => window.app.i18n.setLang('en'));
});

test('one whole-page mic beside Customer: a name alone opens the pick list, then party, line and payment from one sentence (#498)', async ({ page, problems }) => {
    await fakeSpeech(page);
    await login(page, 'staff');
    await showTab(page, 'billing');
    await page.click('#purchaseModeBtn');

    // One mic, a 48 px square to the right of the Customer field, on its row; none inside the field or the Item row
    await expect(page.locator('#purchaseSection [data-voice-mic]:visible')).toHaveCount(1);
    await expect(page.locator('#purchaseSection .bill-entry-row [data-voice-mic]')).toHaveCount(0);
    const pageMic = page.locator('#voiceMicPurchase');
    await expect(pageMic).toBeVisible();
    const field = await page.locator('#customerName').boundingBox();
    const mic = await pageMic.boundingBox();
    expect(mic.x).toBeGreaterThanOrEqual(field.x + field.width - 1);
    expect(Math.abs((mic.y + mic.height / 2) - (field.y + field.height / 2))).toBeLessThanOrEqual(4);
    expect(Math.round(mic.width)).toBe(48);
    expect(mic.height).toBeGreaterThanOrEqual(44);
    await expect(page.locator('#customerName').locator('xpath=..').locator('[data-onclick*="ontact"]')).toBeVisible();
    await say(page, 'Zorawar se');
    await pageMic.click();
    const pickList = page.locator('#modalMessage #voiceNamePick');
    await expect(pickList).toBeVisible();
    await pickList.locator('[data-onclick*="spoken"]').click();
    await expect(page.locator('#customerName')).toHaveValue('Zorawar');

    // One sentence: line, labour and payment; the sheet fills only on Fill bill
    await say(page, 'wheat 10 kg 24, labour 20, cash 100, baaki udhaar');
    await page.click('#voiceMicPurchase');
    const sheet = page.locator('#modalMessage #voiceCheck');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('Rest as due');
    await expect(page.locator('#modalConfirm')).toHaveText('Fill bill');
    await page.click('#modalConfirm');
    await expect(page.locator('#billTable tbody')).toContainText('Wheat');
    await expect(page.locator('#manualLaborCharges')).toHaveValue('20');
    await expect(page.locator('#cashPayment')).toHaveValue('100');
    await expect(page.locator('#dueAmount')).toHaveValue('120');

    const saved = await listDocs('dev_purchases');
    expect(saved.filter(b => b.customerName === 'Zorawar')).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('header at 360 px: Customer | 🎙 with voice on, Customer full width with voice off; Item | Rate fits', async ({ page, problems }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await fakeSpeech(page);
    await login(page, 'staff');
    await showTab(page, 'billing');
    for (const mode of ['purchase', 'sale']) {
        const [btn, section, name, item, rate, mic] = mode === 'purchase'
            ? ['#purchaseModeBtn', '#purchaseSection', '#customerName', '#billItem', '#billRate', '#voiceMicPurchase']
            : ['#saleModeBtn', '#saleSection', '#saleCustomerName', '#saleItem', '#saleRate', '#voiceMicSale'];
        await page.click(btn);
        const row = await page.locator(`${section} .bill-head`).boundingBox();
        const micBox = await page.locator(mic).boundingBox();
        expect(micBox.x + micBox.width).toBeLessThanOrEqual(row.x + row.width + 1);
        const line = await page.locator(`${section} .bill-line-form`).boundingBox();
        const itemBox = await page.locator(item).boundingBox();
        const rateBox = await page.locator(`${section} .bill-entry-rate`).boundingBox();
        expect(rateBox.x + rateBox.width).toBeLessThanOrEqual(line.x + line.width + 1);
        expect(Math.abs(rateBox.y - (await page.locator(`${section} .bill-entry-item`).boundingBox()).y)).toBeLessThanOrEqual(1);
        expect(itemBox.width).toBeGreaterThan(rateBox.width);
        // Rate's chevron is drawn at the same offset from its box's right edge as Item's: both boxes end at their field's edge
        const itemField = await page.locator(`${section} .bill-entry-item`).boundingBox();
        const rateInput = await page.locator(rate).boundingBox();
        expect(Math.abs((itemBox.x + itemBox.width) - (itemField.x + itemField.width))).toBeLessThanOrEqual(1);
        expect(Math.abs((rateInput.x + rateInput.width) - (rateBox.x + rateBox.width))).toBeLessThanOrEqual(1);
        expect(await page.locator(rate).evaluate(el => getComputedStyle(el).backgroundPosition))
            .toBe(await page.locator(item).evaluate(el => getComputedStyle(el).backgroundPosition));
        await expect(page.locator(rate)).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    }

    await page.evaluate(() => window.app.voice.setOn(false));
    await page.click('#purchaseModeBtn');
    await expect(page.locator('#voiceMicPurchase')).toBeHidden();
    const row = await page.locator('#purchaseSection .bill-head').boundingBox();
    const field = await page.locator('#purchaseSection .bill-customer').boundingBox();
    expect(Math.abs(field.width - row.width)).toBeLessThanOrEqual(1);
    expect(problems.pageErrors).toEqual([]);
});
