/**
 * Billing line entry with floating labels (option C), on a phone (390 and 360 px): each label sits on its
 * field's top border, at 14 px or more, and stays there with a value; Item is wider than Rate; the 🎙 is to the
 * right of Customer only with Voice billing on, and the name field takes its room when it is off; Packets · Total and
 * Add to bill share a row; every control is at least 44 px. Both Purchase and Retail sale.
 */
const { test, expect, login, showTab, settle } = require('./support/app');

const MODES = {
    purchase: { btn: '#purchaseModeBtn', section: '#purchaseSection', name: '#customerName', item: '#billItem', rate: '#billRate', weight: '#newWeight', mic: '#voiceMicPurchase' },
    sale: { btn: '#saleModeBtn', section: '#saleSection', name: '#saleCustomerName', item: '#saleItem', rate: '#saleRate', weight: '#saleWeight', mic: '#voiceMicSale' },
};

function voice(page, on) {
    return page.addInitScript((v) => {
        localStorage.setItem('aadhat.voiceBilling', v ? '1' : '0');
        if (v) window.webkitSpeechRecognition = window.SpeechRecognition = class { start() {} abort() {} stop() {} };
    }, on);
}

/** Box of each field, its label (with what is on top at the label's centre), and the row pieces. */
const measure = (page, m) => page.evaluate((s) => {
    const box = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; };
    const q = (sel) => document.querySelector(sel);
    const labels = [s.name, s.item, s.rate, s.weight].map((sel) => {
        const ctl = q(sel);
        const label = document.querySelector(`label[for="${ctl.id}"]`);
        const field = (ctl.closest('.adorn') || ctl).getBoundingClientRect();
        const r = label.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { id: ctl.id, text: label.textContent, fontSize: parseFloat(getComputedStyle(label).fontSize), mid: r.top + r.height / 2, fieldTop: field.top, width: r.width, onTop: hit === label || label.contains(hit) };
    });
    const sec = q(s.section);
    const small = [...sec.querySelectorAll('.bill-main button, .bill-main .input'), q('#billMenu > summary')]
        .filter((el) => el.offsetParent).map((el) => ({ el: el.id || el.className, ...box(el) }))
        .filter((b) => b.width < 44 || b.height < 44);
    const mic = q(s.mic);
    return {
        labels, small,
        item: box(q(s.item)), rate: box(q(s.rate).closest('.adorn')),
        mic: mic.offsetParent ? box(mic) : null,
        sum: box(sec.querySelector('.bill-line-sum')), addLine: box(sec.querySelector('[data-add-line]')),
        contact: box(q(s.name).parentElement.querySelector('.btn-icon')), nameBox: box(q(s.name)),
        scrollWidth: document.documentElement.scrollWidth, vw: innerWidth,
    };
}, m);

for (const width of [390, 360]) {
    for (const on of [true, false]) {
        test(`line entry with floating labels at ${width} px, voice ${on ? 'on' : 'off'}`, async ({ page, problems }, testInfo) => {
            test.skip(testInfo.project.name !== 'phone', 'phone layout');
            await voice(page, on);
            await page.setViewportSize({ width, height: 800 });
            await login(page, 'owner');
            await showTab(page, 'billing');
            expect(await settle(page)).toBe(true);
            for (const [mode, m] of Object.entries(MODES)) {
                await page.click(m.btn);
                await expect(page.locator(m.section)).toBeVisible();
                await page.fill(m.name, 'Ramesh Kumar');
                await page.fill(m.rate, '22000');
                await page.fill(m.weight, '52.5');
                const got = await measure(page, m);
                const where = `${mode} at ${width} px: ${JSON.stringify(got)}`;
                for (const l of got.labels) {
                    expect(l.text.trim(), where).not.toBe('');
                    expect(l.fontSize, `${l.id} label at least 14 px (${where})`).toBeGreaterThanOrEqual(14);
                    expect(Math.abs(l.mid - l.fieldTop), `${l.id} label on the field's top border with a value (${where})`).toBeLessThanOrEqual(3);
                    expect(l.onTop, `${l.id} label not covered (${where})`).toBe(true);
                }
                expect(got.item.width, `Item wider than Rate (${where})`).toBeGreaterThan(got.rate.width);
                expect(Math.abs(got.rate.right - got.addLine.right), `Item | Rate fill the row (${where})`).toBeLessThanOrEqual(1);
                if (on) {
                    expect(Math.abs((got.mic.top + got.mic.bottom) / 2 - (got.nameBox.top + got.nameBox.bottom) / 2), `🎙 on the Customer row (${where})`).toBeLessThanOrEqual(4);
                    expect(got.mic.left, `🎙 right of Customer (${where})`).toBeGreaterThanOrEqual(got.nameBox.right - 1);
                } else {
                    expect(got.mic, `no 🎙 with voice off (${where})`).toBeNull();
                }
                expect(got.small, `44 px targets (${where})`).toEqual([]);
                expect(Math.abs((got.sum.top + got.sum.bottom) / 2 - (got.addLine.top + got.addLine.bottom) / 2) < got.addLine.height / 2, `Packets · Total and Add to bill on one row (${where})`).toBe(true);
                expect(got.contact.right <= got.nameBox.right + 1 && got.contact.left >= got.nameBox.left, `contact button inside the name field (${where})`).toBe(true);
                expect(got.scrollWidth, `no sideways scroll (${where})`).toBeLessThanOrEqual(got.vw);
                await testInfo.attach(`${mode}-${width}-voice-${on ? 'on' : 'off'}`, { body: JSON.stringify(got, null, 1), contentType: 'application/json' });
            }
        });
    }
}
