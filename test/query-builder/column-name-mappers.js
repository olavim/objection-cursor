import {Model} from 'objection';
import {expect} from 'chai';
import {mapKeys, camelCase, snakeCase} from 'lodash';
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

	describe('column name mappers', () => {
		it('lodash snakeCase -> camelCase', async () => {
			class CaseMovie extends Movie {
				static get columnNameMappers() {
					return {
						parse(obj) {
							return mapKeys(obj, (_val, key) => camelCase(key));
						},
						format(obj) {
							return mapKeys(obj, (_val, key) => snakeCase(key));
						}
					};
				}
			}

			const query = CaseMovie
				.query()
				.orderBy('alt_title')
				.orderBy('id', 'asc');

			const results = await query.clone();

			for (const data of results) {
				for (const key of Object.keys(data)) {
					expect(key.match(/_/)).to.be.null;
				}
			}

			return testPagination(query, [2, 5]);
		});

		it('prefix', async () => {
			class PrefixMovie extends Movie {
				static get columnNameMappers() {
					return {
						parse(obj) {
							return mapKeys(obj, (_val, key) => `test_${key}`);
						},
						format(obj) {
							return mapKeys(obj, (_val, key) => key.substring(5));
						}
					};
				}
			}

			const query = PrefixMovie
				.query()
				.orderBy('alt_title')
				.orderBy('id', 'asc');

			const results = await query.clone();

			for (const data of results) {
				for (const key of Object.keys(data)) {
					expect(key.match(/^test_/)).to.not.be.null;
				}
			}

			return testPagination(query, [2, 5]);
		});
	});
};