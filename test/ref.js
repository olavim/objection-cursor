import {expect} from 'chai';
import {Model, ref, raw} from 'objection';
import {mapKeys, snakeCase, camelCase} from 'lodash';
import cursorPagination from '..';

module.exports = knex => {
	describe('reference tests', () => {
		const cursor = cursorPagination({
			pageInfo: {
				total: true,
				hasNext: true,
				hasPrevious: true,
				remaining: true
			}
		});

		class MovieRef extends cursor(Model) {
			static get tableName() {
				return 'movie_refs';
			}
		}

		class Movie extends cursor(Model) {
			static get tableName() {
				return 'movies';
			}

			static get relationMappings() {
				return {
					ref: {
						relation: Model.HasOneRelation,
						modelClass: MovieRef,
						join: {
							from: 'movies.id',
							to: 'movie_refs.movie_id'
						}
					}
				};
			}
		}

		MovieRef.knex(knex);
		Movie.knex(knex);

		it('order by ref - 1 column', async () => {
			const query = Movie.query().orderBy(ref('movies.id'), 'asc');

			const expected = await query.clone();

			let res = await query.clone().limit(5).cursorPage();
			expect(res.results).to.deep.equal(expected.slice(0, 5));
			res = await query.clone().limit(5).cursorPage(res.pageInfo.next);
			expect(res.results).to.deep.equal(expected.slice(5, 10));
			res = await query.clone().limit(10).cursorPage(res.pageInfo.next);
			expect(res.results).to.deep.equal(expected.slice(10, 20));
			res = await query.clone().limit(10).previousCursorPage(res.pageInfo.previous);
			expect(res.results).to.deep.equal(expected.slice(0, 10));
		});

		it('order by ref - 2 columns', async () => {
			const query = Movie.query()
				.orderByCoalesce(ref('ref.data:none').castText(), 'desc', raw('?', ''))
				.orderBy('movies.id', 'asc')
				.joinEager('ref');

			const expected = await query.clone();

			let res = await query.clone().limit(5).cursorPage();
			expect(res.results).to.deep.equal(expected.slice(0, 5));
			res = await query.clone().limit(5).cursorPage(res.pageInfo.next);
			expect(res.results).to.deep.equal(expected.slice(5, 10));
			res = await query.clone().limit(10).cursorPage(res.pageInfo.next);
			expect(res.results).to.deep.equal(expected.slice(10, 20));
			res = await query.clone().limit(10).previousCursorPage(res.pageInfo.previous);
			expect(res.results).to.deep.equal(expected.slice(0, 10));
		});

		it('order by ref with column mappers', async () => {
			class CaseMovie extends Movie {
				$formatDatabaseJson(json) {
					const formatted = super.$formatDatabaseJson(json);
					return mapKeys(formatted, (_val, key) => snakeCase(key));
				}

				$parseDatabaseJson(json) {
					const parsed = super.$parseDatabaseJson(json);
					return mapKeys(parsed, (_val, key) => camelCase(key));
				}
			}

			const query = CaseMovie.query()
				.joinEager('ref')
				.orderByCoalesce(ref('ref.data:title').castText(), 'desc')
				.orderBy('movies.id', 'asc');

			const expected = await query.clone();

			let res = await query.clone().limit(5).cursorPage();
			expect(res.results).to.deep.equal(expected.slice(0, 5));
			res = await query.clone().limit(5).cursorPage(res.pageInfo.next);
			expect(res.results).to.deep.equal(expected.slice(5, 10));
			res = await query.clone().limit(10).cursorPage(res.pageInfo.next);
			expect(res.results).to.deep.equal(expected.slice(10, 20));
			res = await query.clone().limit(10).previousCursorPage(res.pageInfo.previous);
			expect(res.results).to.deep.equal(expected.slice(0, 10));
		});
	});
};
