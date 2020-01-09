import {expect} from 'chai';
import {Model, ref, raw, Pojo} from 'objection';
import Knex from 'knex';
import {mapKeys, snakeCase, camelCase} from 'lodash';
import cursorPagination from '../src';

export default (knex: Knex) => {
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
				}
			}
		}

		MovieRef.knex(knex);
		Movie.knex(knex);

		it('order by ref', () => {
			const query = Movie
				.query()
				.orderByCoalesce(ref('ref.data:none').castText(), 'desc', raw('?', ''))
				.orderBy('movies.id', 'asc')
				.joinEager('ref');

			let expected: (typeof query)['ResultType'];

			return query.clone()
				.then(res => {
					expected = res;
					return query.clone().limit(5).cursorPage();
				})
				.then(res => {
					expect(res.results).to.deep.equal(expected.slice(0, 5));
					return query.clone().limit(5).cursorPage(res.pageInfo.next);
				})
				.then(res => {
					expect(res.results).to.deep.equal(expected.slice(5, 10));
					return query.clone().limit(10).cursorPage(res.pageInfo.next);
				})
				.then(res => {
					expect(res.results).to.deep.equal(expected.slice(10, 20));
					return query.clone().limit(10).previousCursorPage(res.pageInfo.previous);
				})
				.then(res => {
					expect(res.results).to.deep.equal(expected.slice(0, 10));
				});
		});

		it('order by ref with column mappers', () => {
			class CaseMovie extends Movie {
				$formatDatabaseJson(json: Pojo) {
					const formatted = super.$formatDatabaseJson(json);
					return mapKeys(formatted, (val, key) => snakeCase(key));
				}

				$parseDatabaseJson(json: Pojo) {
					const parsed = super.$parseDatabaseJson(json);
					return mapKeys(parsed, (val, key) => camelCase(key));
				}
			}

			const query = CaseMovie
				.query()
				.joinEager('ref')
				.orderByCoalesce(ref('ref.data:title').castText(), 'desc')
				.orderBy('movies.id', 'asc');

			let expected: (typeof query)['ResultType'];

			return query.clone()
				.then(res => {
					expected = res;
					return query.clone().limit(10).cursorPage();
				})
				.then(res => {
					expect(res.results).to.deep.equal(expected.slice(0, 10));
					return query.clone().limit(10).cursorPage(res.pageInfo.next);
				})
				.then(res => {
					expect(res.results).to.deep.equal(expected.slice(10, 20));
					return query.clone().limit(10).previousCursorPage(res.pageInfo.previous);
				})
				.then(res => {
					expect(res.results).to.deep.equal(expected.slice(0, 10));
				});
		});
	});
}
