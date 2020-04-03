import {expect} from 'chai';
import {ref} from 'objection';
import {columnToProperty} from '../lib/convert';

describe('conversion tests', () => {
	describe('column to property', () => {
		it('string', () => {
			expect(columnToProperty('author_name')).to.equal('author_name');
			expect(columnToProperty('movie.author_name')).to.equal('author_name');
			expect(columnToProperty('movie.data:id')).to.equal('data:id');
			expect(columnToProperty('schema.movie.author_name')).to.equal('author_name');
		});

		it('ref', () => {
			expect(columnToProperty(ref('id'))).to.equal('id');
			expect(columnToProperty(ref('movie.id'))).to.equal('movie.id');
			expect(columnToProperty(ref('data:id'))).to.equal('data.id');
			expect(columnToProperty(ref('movie.data:id'))).to.equal('movie.data.id');
			expect(columnToProperty(ref('movie.data:some.field'))).to.equal('movie.data.some.field');
		});

		it('ref with cast', () => {
			expect(columnToProperty(ref('a').castText())).to.equal('a');
			expect(columnToProperty(ref('a.a').castText())).to.equal('a.a');
			expect(columnToProperty(ref('a.a:b').castText())).to.equal('a.a.b');
			expect(columnToProperty(ref('a.a:b.c').castText())).to.equal('a.a.b.c');
		});
	});
});
