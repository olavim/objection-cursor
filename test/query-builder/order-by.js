import {expect} from 'chai';
import {Model} from 'objection';
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

	describe('orderBy', () => {
		it('other where statements', () => {
			const query = Movie
				.query()
				.orderBy('author')
				.orderBy('id')
				.where('title', 'like', 'movie-0%');

			return testPagination(query, [2, 5]);
		});

		it('one order by column', () => {
			const query = Movie
				.query()
				.orderBy('id');

			return testPagination(query, [2, 5]);
		});

		it('no results', async () => {
			const query = Movie
				.query()
				.orderBy('id', 'asc')
				.where('id', '0');

			const expected = await query.clone();
			expect(expected).to.deep.equal([]);

			let res = await query.clone().cursorPage();
			expect(res.results).to.deep.equal([]);
			res = await query.clone().cursorPage(res.pageInfo.next);
			expect(res.results).to.deep.equal([]);
			res = await query.clone().previousCursorPage(res.pageInfo.previous);
			expect(res.results).to.deep.equal([]);
			res = await query.clone().previousCursorPage(res.pageInfo.previous);
			expect(res.results).to.deep.equal([]);
		});

		it('[table].[column]', () => {
			const query = Movie
				.query()
				.orderBy('movies.id', 'asc');

			return testPagination(query, [2, 5]);
		});

		it('date columns', () => {
			const query = Movie
				.query()
				.orderBy('createdAt', 'asc')
				.orderBy('id', 'asc');

			return testPagination(query, [2, 5]);
		});
	});
};