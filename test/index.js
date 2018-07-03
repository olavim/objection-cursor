'use strict';

const Knex = require('knex');
const expect = require('chai').expect;
const Movie = require('./fixtures/Movie');

function padStart(str, targetLength, padString) {
	let padded = str;
	while (padded.length < targetLength) {
		padded = padString + padded;
	}
	return padded;
}

const generateMovies = num => {
	const d = new Date(2000, 1, 1, 0, 0, 0, 0);
	const arr = [...new Array(num)].map((_val, key) => {
		return {
			title: `movie-${padStart(String(key % 15), 2, '0')}`,
			author: `author-${key % 5}`,
			// Add some null values
			date: key % 3 === 0 ? null : new Date(d.getTime() + (key % 7)).toISOString()
		};
	});

	return arr;
};

describe('database tests', () => {
	const knex = Knex({
		client: 'sqlite3',
		useNullAsDefault: true,
		connection: {
			filename: 'test.db'
		}
	});

	before(() => {
		return knex.schema.dropTableIfExists('movies');
	});

	before(() => {
		return knex.schema.createTable('movies', table => {
			table.increments();
			table.string('title');
			table.string('author');
			table.dateTime('date');
		});
	});

	before(() => {
		return knex('movies').then(() => {
			return knex('movies').insert(generateMovies(20));
		});
	});

	after(() => {
		return knex.destroy();
	});

	describe('cursor tests', () => {
		function test(query, pages) {
			let expected;
			let perPage;
			let page = 0;

			let q = query.clone().then(res => {
				expected = res;
				perPage = Math.ceil(expected.length / pages);
				return query.clone().limit(perPage).cursorPage();
			});

			for (let i = 0; i < pages; i++) {
				q = q.then(({results, pageInfo}) => {
					expect(pageInfo.total).to.equal(expected.length);
					expect(results).to.deep.equal(expected.slice(perPage * page, perPage * (page + 1)));

					if ((page + 1) * perPage > expected.length) {
						perPage = expected.length - (page * perPage);
					}

					page++;
					expect(results.length).to.equal(perPage);
					return query.clone().limit(perPage).cursorPage(pageInfo.cursor);
				});
			}

			return q;
		}

		it('other where statements', () => {
			const query = Movie
				.query(knex)
				.orderBy('id')
				.where('title', 'like', 'movie-0%');

			return test(query, 5);
		});

		it('one order by col', () => {
			const query = Movie
				.query(knex)
				.orderBy('id');

			return test(query, 5);
		});

		it('two order by cols: asc,desc', () => {
			const query = Movie
				.query(knex)
				.orderBy('title', 'asc')
				.orderBy('id', 'desc');

			return test(query, 5);
		});

		it('three order by cols: asc,desc,asc', () => {
			const query = Movie
				.query(knex)
				.orderBy('title', 'asc')
				.orderBy('author', 'desc')
				.orderBy('id', 'asc');

			return test(query, 5);
		});

		it('four order by cols: asc,desc,desc,asc', () => {
			const query = Movie
				.query(knex)
				.orderBy('title', 'asc')
				.orderBy('author', 'desc')
				.orderBy('date', 'desc')
				.orderBy('id', 'asc');

			return test(query, 5);
		});

		it('go to end, then back to beginning', () => {
			const query = Movie
				.query(knex)
				.orderBy('title', 'desc')
				.orderBy('id', 'asc');

			let expected;

			return query.clone()
				.then(res => {
					expected = res;
					return query.clone().limit(5).cursorPage();
				})
				.then(({results, pageInfo}) => {
					expect(results).to.deep.equal(expected.slice(0, 5));
					return query.clone().limit(5).cursorPage(pageInfo.cursor);
				})
				.then(({results, pageInfo}) => {
					expect(results).to.deep.equal(expected.slice(5, 10));
					return query.clone().limit(10).cursorPage(pageInfo.cursor);
				})
				.then(({results, pageInfo}) => {
					expect(results).to.deep.equal(expected.slice(10, 20));
					return query.clone().limit(10).cursorPage(pageInfo.cursor);
				})
				.then(({results, pageInfo}) => {
					expect(results).to.deep.equal([]);
					return query.clone().limit(5).previousCursorPage(pageInfo.cursor);
				})
				.then(({results, pageInfo}) => {
					expect(results).to.deep.equal(expected.slice(15, 20));
					return query.clone().limit(5).previousCursorPage(pageInfo.cursor);
				})
				.then(({results, pageInfo}) => {
					expect(results).to.deep.equal(expected.slice(10, 15));
					return query.clone().limit(5).previousCursorPage(pageInfo.cursor);
				})
				.then(({results, pageInfo}) => {
					expect(results).to.deep.equal(expected.slice(5, 10));
					return query.clone().limit(5).previousCursorPage(pageInfo.cursor);
				})
				.then(({results, pageInfo}) => {
					expect(results).to.deep.equal(expected.slice(0, 5));
					return query.clone().limit(5).previousCursorPage(pageInfo.cursor);
				})
				.then(({results, pageInfo}) => {
					expect(results).to.deep.equal([]);
					return query.clone().limit(5).cursorPage(pageInfo.cursor);
				})
				.then(({results}) => {
					expect(results).to.deep.equal(expected.slice(0, 5));
				});
		});

		it('no results', () => {
			const query = Movie
				.query(knex)
				.orderBy('id', 'asc')
				.where('id', '0');

				return query.clone()
					.then(res => {
						expect(res).to.deep.equal([]);
						return query.clone().cursorPage();
					})
					.then(res => {
						expect(res.results).to.deep.equal([]);
						return query.clone().cursorPage(res.pageInfo.cursor);
					})
					.then(res => {
						expect(res.results).to.deep.equal([]);
						return query.clone().previousCursorPage(res.pageInfo.cursor);
					})
					.then(res => {
						expect(res.results).to.deep.equal([]);
						return query.clone().previousCursorPage(res.pageInfo.cursor);
					})
					.then(res => {
						expect(res.results).to.deep.equal([]);
					});
		});
	});
});
