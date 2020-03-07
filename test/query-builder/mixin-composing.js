import {Model} from 'objection';
import {expect} from 'chai';
import {mapKeys, camelCase} from 'lodash';
import cursorPagination from '../../';
import testPagination from './lib/pagination';

export default knex => {
	const cursor = cursorPagination({
		limit: 10,
		results: true,
		nodes: true,
		pageInfo: {
			total: true,
			hasMore: true,
			hasNext: true,
			hasPrevious: true,
			remaining: true,
			remainingBefore: true,
			remainingAfter: true
		}
	});

	class Movie extends cursor(Model) {
		static get tableName() {
			return 'movies';
		}
	}

	Movie.knex(knex);

	describe('mixin composing', () => {
		it('overriden orderBy', async () => {
			class MixinMovie extends Movie {
				static get QueryBuilder() {
					return class extends Movie.QueryBuilder {
						orderBy(...args) {
							return super.orderBy(...args);
						}
					};
				}
			}

			const query = MixinMovie
				.query()
				.orderBy('id', 'asc');

			return testPagination(query, [2, 5]);
		});

		it('wrapped results', async () => {
			class MixinMovie extends Movie {
				static get QueryBuilder() {
					return class extends Movie.QueryBuilder {
						cursorPage(...args) {
							return super.cursorPage(...args).runAfter(res => ({wrapped: res}));
						}
					};
				}
			}

			const query = MixinMovie
				.query()
				.orderBy('alt_title')
				.orderBy('id', 'asc');

			const expected = await query.clone();

			const res1 = await query.clone().cursorPage();
			expect(res1.wrapped.results).to.deep.equal(expected.slice(0, 10));
			const res2 = await query.clone().cursorPage(res1.wrapped.pageInfo.next);
			expect(res2.wrapped.results).to.deep.equal(expected.slice(10, 20));
			const res3 = await query.clone().cursorPage(res2.wrapped.pageInfo.next);
			expect(res3.wrapped.results).to.deep.equal([]);
		});
	});
};