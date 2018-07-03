'use strict';

const expect = require('chai').expect;
const {serializeCursor} = require('../lib/serialize');

describe('serialization tests', () => {
	describe('serialization', () => {
		it('serializes into url-safe strings', () => {
			const ops = [{col: 'a'}, {col: 'b'}];
			const first = {a: 'a>', b: 'a?'}
			const last = {a: 'a>', b: 'a?'}

			const s = serializeCursor(ops, first, last);
			expect(/^[a-zA-Z~._-]+$/.test(s)).to.be.true;
		});
	});
});
