const expect = require('chai').expect;
const {Model, ref} = require('objection');
const {mapKeys, snakeCase, camelCase} = require('lodash');
const cursorPagination = require('..');

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
				}
			}
		}

		it('order by ref', () => {
			const query = Movie
				.query(knex)
				.joinEager('ref')
				.orderBy(ref('ref.data:title').castText(), 'desc')
				.orderBy('movies.id', 'asc');

			let expected;

			return query.clone()
				.then(res => {
					expected = res;
					return query.clone().limit(10).cursorPage();
				})
				.then(res => {
					expect(res.results).to.deep.equal(expected.slice(0, 10));
					return query.clone().cursorPage(res.pageInfo.next);
				})
				.then(res => {
					expect(res.results).to.deep.equal(expected.slice(10, 20));
					return query.clone().previousCursorPage(res.pageInfo.previous);
				})
				.then(res => {
					expect(res.results).to.deep.equal(expected.slice(0, 10));
				});
		});
	});
}
