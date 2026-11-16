/**
 * Owner (v730): the people the shop buys from are "Customer" too. The Purchase bill's name field and
 * every purchase-party label read Customer / ग्राहक, the same word as on Retail sale. Display text only:
 * the keys, ids and stored fields (customerName, supplier*) are unchanged.
 */
import fs from 'fs';
import path from 'path';
import en from '../i18n/en.js';
import hi from '../i18n/hi.js';

const billing = fs.readFileSync(path.join(__dirname, '..', '..', 'templates', 'billing.html'), 'utf8');

test('the Purchase name label reads Customer in English and ग्राहक in Hindi, like Retail sale', () => {
    expect(en['ui.billing.supplier_label']).toBe('Customer');
    expect(hi['ui.billing.supplier_label']).toBe('ग्राहक');
    expect(hi['ui.billing.supplier_label']).toBe(hi['ui.billing.customer_label']);
    expect(billing).toMatch(/<label for="customerName"><span data-i18n="ui\.billing\.supplier_label">Customer<\/span>/);
});

test('no screen text says Supplier (en) or विक्रेता / सप्लायर (hi)', () => {
    expect(Object.entries(en).filter(([, v]) => /supplier/i.test(v)).map(([k]) => k)).toEqual([]);
    expect(Object.entries(hi).filter(([, v]) => /विक्रेता|सप्लायर/.test(v)).map(([k]) => k)).toEqual([]);
});
