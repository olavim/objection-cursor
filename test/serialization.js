'use strict';

const expect = require('chai').expect;
const {serializeCursor, deserializeCursor} = require('../lib/serialize');

const SERIALIZE_ITEMS = [
	{a: '<IMG SRC=&#0000106&#0000097&#0000118&#0000097&#0000115&#0000099&#0000114&#0000105&#0000112>'},
	{a: new Date(38573587)},
	{a: 12}
]

describe('serialization tests', () => {
	it('serializes into url-safe strings', () => {
		for (const item of SERIALIZE_ITEMS) {
			const cursor = serializeCursor(Object.keys(item), item);
			expect(/^[a-zA-Z0-9~._-]+$/.test(cursor)).to.be.true;
		}
	});

	it('deserializes cursor back to item', () => {
		for (const item of SERIALIZE_ITEMS) {
			const cursor = serializeCursor(Object.keys(item), item);
			const deserialized = deserializeCursor(Object.keys(item), cursor);
			expect(deserialized).to.deep.equal(item);
		}
	});
});
