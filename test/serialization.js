import {expect} from 'chai';
import {serializeCursor, deserializeCursor} from '../lib/serialize';

const SERIALIZE_ITEMS = [
	['<IMG SRC=&#0000106&#0000097&#0000118&#0000097&#0000115&#0000099&#0000114&#0000105&#0000112>'],
	[new Date(38573587)],
	[12]
];

describe('serialization tests', () => {
	it('serializes into url-safe strings', () => {
		for (const item of SERIALIZE_ITEMS) {
			const cursor = serializeCursor(item);
			expect(/^[a-zA-Z0-9~._-]+$/.test(cursor)).to.be.true;
		}
	});

	it('deserializes cursor back to item', () => {
		for (const item of SERIALIZE_ITEMS) {
			const cursor = serializeCursor(item);
			const deserialized = deserializeCursor(cursor);
			expect(deserialized).to.deep.equal(item);
		}
	});
});
