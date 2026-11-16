/** @jest-environment node */
const { indexKey, missingIndexes } = require('../../tools/ci/indexes-live');

const repo = {
    indexes: [
        { collectionGroup: 'purchases', queryScope: 'COLLECTION', fields: [{ fieldPath: 'date', order: 'ASCENDING' }, { fieldPath: 'total', order: 'DESCENDING' }] },
        { collectionGroup: 'rent_charges', queryScope: 'COLLECTION', fields: [{ fieldPath: 'tags', arrayConfig: 'CONTAINS' }, { fieldPath: 'month', order: 'ASCENDING' }] }
    ]
};
const live = (group, fields, state = 'READY') => ({
    name: `projects/p/databases/(default)/collectionGroups/${group}/indexes/x`,
    queryScope: 'COLLECTION',
    state,
    fields: [...fields, { fieldPath: '__name__', order: fields[fields.length - 1].order || 'ASCENDING' }]
});

test('every repo index READY live (the API adds __name__) -> nothing missing', () => {
    const all = [live('purchases', repo.indexes[0].fields), live('rent_charges', repo.indexes[1].fields), live('other', [{ fieldPath: 'a', order: 'ASCENDING' }])];
    expect(missingIndexes(repo, all)).toEqual([]);
});

test('an index still building, in another order or absent counts as missing', () => {
    const reversed = [...repo.indexes[0].fields].reverse();
    expect(missingIndexes(repo, [live('purchases', repo.indexes[0].fields, 'CREATING'), live('rent_charges', repo.indexes[1].fields)]).map(indexKey))
        .toEqual(['purchases|COLLECTION|date:ASCENDING,total:DESCENDING']);
    expect(missingIndexes(repo, [live('purchases', reversed)])).toHaveLength(2);
    expect(missingIndexes(repo, [])).toHaveLength(2);
});
