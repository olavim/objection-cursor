import {expect} from 'chai';
import {Model, raw} from 'objection';
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

	describe('orderByCoalesce', () => {
		it('two order by columns: asc,desc', () => {
			const query = Movie
				.query()
				.orderByCoalesce('title', 'asc')
				.orderBy('id', 'desc');

			return testPagination(query, [2, 5]);
		});

		it('three order by columns: asc,desc,asc', () => {
			const query = Movie
				.query()
				.orderByCoalesce('title', 'asc')
				.orderBy('author', 'desc')
				.orderBy('id', 'asc');

			return testPagination(query, [2, 5]);
		});

		it('four order by columns: asc,desc,desc,asc', () => {
			const datetimeType = knex.client.config.client === 'mysql'
				? 'datetime'
				: 'timestamptz';

			const query = Movie
				.query()
				.orderByCoalesce('title', 'asc')
				.orderBy('author', 'desc')
				.orderByCoalesce('date', 'desc', raw(`CAST(? as ${datetimeType})`, '1970-1-1'))
				.orderBy('id', 'asc');

			return testPagination(query, [2, 5]);
		});

		it('cursorPage does not have to be last call', async () => {
			const cursorPage = async (...args) => Movie.query()
				.cursorPage(...args)
				.orderByCoalesce('title', 'desc')
				.orderBy('id', 'asc')
				.limit(5);

			const expected = await Movie.query()
				.orderByCoalesce('title', 'desc')
				.orderBy('id', 'asc');

			let res = await cursorPage();
			expect(res.results).to.deep.equal(expected.slice(0, 5));
			res = await cursorPage(res.pageInfo.next);
			expect(res.results).to.deep.equal(expected.slice(5, 10));
			res = await cursorPage(res.pageInfo.previous, true);
			expect(res.results).to.deep.equal(expected.slice(0, 5));
		});

		it('order by coalesce raw', () => {
			const query = Movie
				.query()
				.orderByCoalesce('title', 'desc', raw('?', ['ab']))
				.orderBy('id', 'asc');

			return testPagination(query, [2, 5]);
		});

		it('column formatter', async () => {
			class Title {
				constructor(title) {
					this.title = title;
				}

				toString() {
					return this.title;
				}
			}

			class SuperMovie extends Movie {
				$parseDatabaseJson(json) {
					json = super.$parseDatabaseJson(json);

					if (json.title) {
						json.title = new Title(json.title);
					}

					return json;
				}

				$formatDatabaseJson(json) {
					json = super.$formatDatabaseJson(json);

					if (json.title instanceof Title) {
						json.title = json.title.toString();
					}

					return json;
				}
			}

			const query = SuperMovie.query()
				.orderByCoalesce('title', 'asc')
				.orderBy('id');

			return testPagination(query, [2, 5]);
		});
	});
};