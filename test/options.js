const expect = require('chai').expect;
const Model = require('objection').Model;
const cursorPagination = require('..');

module.exports = knex => {
	describe('options tests', () => {
		it('has total', () => {
			class Movie extends cursorPagination({pageInfo: {total: true}})(Model) {
				static get tableName() {
					return 'movies';
				}
			}

			return Movie
				.query(knex)
				.orderBy('id', 'asc')
				.cursorPage()
				.then(({pageInfo}) => {
					expect(pageInfo.total).to.equal(20);
				});
		});

		it('has remaining', () => {
			class Movie extends cursorPagination({pageInfo: {remaining: true}})(Model) {
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
					expect(pageInfo.remaining).to.equal(10);
				});
		});

		it('has hasNext', () => {
			class Movie extends cursorPagination({pageInfo: {hasNext: true}})(Model) {
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
					expect(pageInfo.hasNext).to.equal(true);
				});
		});

		it('has hasPrevious', () => {
			class Movie extends cursorPagination({pageInfo: {hasPrevious: true}})(Model) {
				static get tableName() {
					return 'movies';
				}
			}

			return Movie
				.query(knex)
				.orderBy('id', 'asc')
				.cursorPage()
				.then(({pageInfo}) => {
					expect(pageInfo.hasPrevious).to.equal(false);
				});
		});

		it('has limit', () => {
			class Movie extends cursorPagination({limit: 10})(Model) {
				static get tableName() {
					return 'movies';
				}
			}

			return Movie
				.query(knex)
				.orderBy('id', 'asc')
				.cursorPage()
				.then(({results}) => {
					expect(results.length).to.equal(10);
				});
		});
	});
}