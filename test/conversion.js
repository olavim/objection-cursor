'use strict';

const expect = require('chai').expect;
const {mapKeys, snakeCase, camelCase} = require('lodash');
const {Model, ref} = require('objection');
const {columnToProperty} = require('../lib/convert');

describe('conversion tests', () => {
	describe('column to property', () => {
		class Movie extends Model {
			static get tableName() {
				return 'movies';
			}
		}

		class CaseMovie extends Movie {
			$formatDatabaseJson(json) {
				const formatted = super.$formatDatabaseJson(json);
				return mapKeys(formatted, (val, key) => snakeCase(key));
			}

			$parseDatabaseJson(json) {
				const parsed = super.$parseDatabaseJson(json);
				return mapKeys(parsed, (val, key) => camelCase(key));
			}
		}

		it('string', () => {
			expect(columnToProperty(Movie, 'author_name')).to.equal('author_name');
			expect(columnToProperty(Movie, 'movie.author_name')).to.equal('author_name');
			expect(columnToProperty(Movie, 'movie.data:id')).to.equal('data:id');
			expect(columnToProperty(Movie, 'schema.movie.author_name')).to.equal('author_name');
		});

		it('string with column mapper', () => {
			expect(columnToProperty(CaseMovie, 'author_name')).to.equal('authorName');
			expect(columnToProperty(CaseMovie, 'movie.author_name')).to.equal('authorName');
			expect(columnToProperty(CaseMovie, 'movie.data:id')).to.equal('dataId');
			expect(columnToProperty(CaseMovie, 'schema.movie.author_name')).to.equal('authorName');
		});

		it('ref', () => {
			expect(columnToProperty(Movie, ref('id'))).to.equal('id');
			expect(columnToProperty(Movie, ref('movie.id'))).to.equal('movie.id');
			expect(columnToProperty(Movie, ref('data:id'))).to.equal('data.id');
			expect(columnToProperty(Movie, ref('movie.data:id'))).to.equal('movie.data.id');
			expect(columnToProperty(Movie, ref('movie.data:some.field'))).to.equal('movie.data.some.field');
		});

		it('ref with column mapper', () => {
			expect(columnToProperty(CaseMovie, ref('movie.data:id'))).to.equal('movie.data.id');
			expect(columnToProperty(CaseMovie, ref('movie.data:some.field'))).to.equal('movie.data.some.field');
			expect(columnToProperty(CaseMovie, ref('movie.data:author_id'))).to.equal('movie.data.author_id');
			expect(columnToProperty(CaseMovie, ref('movie.external_data:author_id'))).to.equal('movie.externalData.author_id');
		});

		it('ref with cast', () => {
			expect(columnToProperty(Movie, ref('a').castText())).to.equal('a');
			expect(columnToProperty(Movie, ref('a.a').castText())).to.equal('a.a');
			expect(columnToProperty(Movie, ref('a.a:b').castText())).to.equal('a.a.b');
			expect(columnToProperty(Movie, ref('a.a:b.c').castText())).to.equal('a.a.b.c');
		});
	});
});
