import {expect} from 'chai';
import {Model} from 'objection';
import cursorPagination from '..';

module.exports = knex => {
	describe('options tests', () => {
		it('has total', async () => {
			class Movie extends cursorPagination({pageInfo: {total: true}})(Model) {
				static get tableName() {
					return 'movies';
				}
			}

			const res = await Movie.query(knex)
				.orderBy('id', 'asc')
				.cursorPage();

			expect(res.pageInfo.total).to.equal(20);
		});

		it('has remaining', async () => {
			class Movie extends cursorPagination({pageInfo: {remaining: true}})(Model) {
				static get tableName() {
					return 'movies';
				}
			}

			const res = await Movie.query(knex)
				.orderBy('id', 'asc')
				.cursorPage()
				.limit(10);

			expect(res.pageInfo.remaining).to.equal(10);
		});

		it('has remainingBefore', async () => {
			class Movie extends cursorPagination({pageInfo: {remainingBefore: true}})(Model) {
				static get tableName() {
					return 'movies';
				}
			}

			const res = await Movie.query(knex)
				.orderBy('id', 'asc')
				.cursorPage()
				.limit(10);

			expect(res.pageInfo.remainingBefore).to.equal(0);
		});

		it('has remainingAfter', async () => {
			class Movie extends cursorPagination({pageInfo: {remainingAfter: true}})(Model) {
				static get tableName() {
					return 'movies';
				}
			}

			const res = await Movie.query(knex)
				.orderBy('id', 'asc')
				.cursorPage()
				.limit(10);

			expect(res.pageInfo.remainingAfter).to.equal(10);
		});

		it('has hasMore', async () => {
			class Movie extends cursorPagination({pageInfo: {hasMore: true}})(Model) {
				static get tableName() {
					return 'movies';
				}
			}

			return Movie
				.query(knex)
				.orderBy('id', 'asc')
				.cursorPage()
				.limit(10)
				.then(({pageInfo}) => {
					expect(pageInfo.hasMore).to.equal(true);
				});
		});

		it('has hasNext', async () => {
			class Movie extends cursorPagination({pageInfo: {hasNext: true}})(Model) {
				static get tableName() {
					return 'movies';
				}
			}

			const res = await Movie.query(knex)
				.orderBy('id', 'asc')
				.cursorPage()
				.limit(10);

			expect(res.pageInfo.hasNext).to.equal(true);
		});

		it('has hasPrevious', async () => {
			class Movie extends cursorPagination({pageInfo: {hasPrevious: true}})(Model) {
				static get tableName() {
					return 'movies';
				}
			}

			const res = await Movie.query(knex)
				.orderBy('id', 'asc')
				.cursorPage();

			expect(res.pageInfo.hasPrevious).to.equal(false);
		});

		it('has limit', async () => {
			class Movie extends cursorPagination({limit: 10})(Model) {
				static get tableName() {
					return 'movies';
				}
			}

			const res = await Movie.query(knex)
				.orderBy('id', 'asc')
				.cursorPage();

			expect(res.results.length).to.equal(10);
		});
	});
};