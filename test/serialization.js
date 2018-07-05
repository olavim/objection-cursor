'use strict';

const expect = require('chai').expect;
const {serializeCursor} = require('../lib/serialize');

describe('serialization tests', () => {
	describe('serialization', () => {
		it('serializes into url-safe strings', () => {
			const ops = [{prop: 'a'}, {prop: 'b'}];
			const item = {a: 'a>', b: 'a?'}

			const str = serializeCursor(ops, item);
			expect(/^[a-zA-Z~._-]+$/.test(str)).to.be.true;
		});
	});
});
