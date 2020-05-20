import {expect} from 'chai';
import {ref, Model} from 'objection';
import {columnToProperty} from '../lib/convert';

describe('conversion tests', () => {
	describe('column to property', () => {
		class Movie extends Model {
			static get tableName() {
				return 'movie';
			}
		}
		class SchemaMovie extends Model {
			static get tableName() {
				return 'movies.movie';
			}
		}

		it('string', () => {
			expect(columnToProperty(Movie, 'author_name')).to.equal('author_name');
			expect(columnToProperty(Movie, 'movie.author_name')).to.equal('author_name');
			expect(columnToProperty(Movie, 'movie.data:id')).to.equal('data:id');
			expect(columnToProperty(Movie, 'schema.movie.author_name')).to.equal('author_name');
		});

		it('ref', () => {
			expect(columnToProperty(Movie, ref('id'))).to.equal('id');
			expect(columnToProperty(Movie, ref('movie.id'))).to.equal('id');
			expect(columnToProperty(Movie, ref('data:id'))).to.equal('data.id');
			expect(columnToProperty(Movie, ref('movie.data:id'))).to.equal('data.id');
			expect(columnToProperty(Movie, ref('movie.data:some.field'))).to.equal('data.some.field');

			expect(columnToProperty(SchemaMovie, ref('id'))).to.equal('id');
			expect(columnToProperty(SchemaMovie, ref('movies.movie.id'))).to.equal('id');
			expect(columnToProperty(SchemaMovie, ref('data:id'))).to.equal('data.id');
			expect(columnToProperty(SchemaMovie, ref('movies.movie.data:id'))).to.equal('data.id');
			expect(columnToProperty(SchemaMovie, ref('movies.movie.data:some.field'))).to.equal('data.some.field');
		});

		it('ref with cast', () => {
			expect(columnToProperty(Movie, ref('a').castText())).to.equal('a');
			expect(columnToProperty(Movie, ref('a.a').castText())).to.equal('a.a');
			expect(columnToProperty(Movie, ref('a.a:b').castText())).to.equal('a.a.b');
			expect(columnToProperty(Movie, ref('a.a:b.c').castText())).to.equal('a.a.b.c');
		});
	});
});
