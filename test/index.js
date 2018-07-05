'use strict';

const Knex = require('knex');
const expect = require('chai').expect;
const Model = require('objection').Model;
const {mapKeys, snakeCase, camelCase} = require('lodash');
const cursorPagination = require('..');

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
			alt_title: `film-${padStart(String(key % 15), 2, '0')}`,
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
			table.string('alt_title');
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
		const cursor = cursorPagination({
			pageInfo: {
				total: true,
				hasNext: true,
				hasPrevious: true,
				remaining: true
			}
		});

		class Movie extends cursor(Model) {
			static get tableName() {
				return 'movies';
			}
		}

		function test(query, pagesRange) {
			const tasks = [];
			for (let pages = pagesRange[0]; pages < pagesRange[1]; pages++) {
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
						expect(results, `page: ${i+1}/${pages}`).to.deep.equal(expected.slice(perPage * page, perPage * (page + 1)));

						if ((page + 1) * perPage > expected.length) {
							perPage = expected.length - (page * perPage);
						}

						page++;
						expect(results.length).to.equal(perPage);
						return query.clone().limit(perPage).cursorPage(pageInfo.next);
					});
				}

				q = q
					.then(({pageInfo}) => {
						return query.clone().limit(5).cursorPage(pageInfo.next);
					})
					.then(({results}) => {
						expect(results).to.deep.equal([]);
					});

				tasks.push(q);
			}
			return Promise.all(tasks);
		}

		it('other where statements', () => {
			const query = Movie
				.query(knex)
				.orderBy('author')
				.orderBy('id')
				.where('title', 'like', 'movie-0%');

			return test(query, [2, 5]);
		});

		it('one order by col', () => {
			const query = Movie
				.query(knex)
				.orderBy('id');

			return test(query, [2, 5]);
		});

		it('two order by cols: asc,desc', () => {
			const query = Movie
				.query(knex)
				.orderBy('title', 'asc')
				.orderBy('id', 'desc');

			return test(query, [2, 5]);
		});

		it('three order by cols: asc,desc,asc', () => {
			const query = Movie
				.query(knex)
				.orderBy('title', 'asc')
				.orderBy('author', 'desc')
				.orderBy('id', 'asc');

			return test(query, [2, 5]);
		});

		it('four order by cols: asc,desc,desc,asc', () => {
			const query = Movie
				.query(knex)
				.orderBy('title', 'asc')
				.orderBy('author', 'desc')
				.orderBy('date', 'desc')
				.orderBy('id', 'asc');

			return test(query, [2, 5]);
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
					expect(pageInfo.hasNext).to.be.true;
					expect(pageInfo.hasPrevious).to.be.false;
					expect(pageInfo.remaining).to.equal(15);
					expect(results).to.deep.equal(expected.slice(0, 5));
					return query.clone().limit(5).cursorPage(pageInfo.next);
				})
				.then(({results, pageInfo}) => {
					expect(pageInfo.hasNext).to.be.true;
					expect(pageInfo.hasPrevious).to.be.true;
					expect(pageInfo.remaining).to.equal(10);
					expect(results).to.deep.equal(expected.slice(5, 10));
					return query.clone().limit(10).cursorPage(pageInfo.next);
				})
				.then(({results, pageInfo}) => {
					expect(pageInfo.hasNext).to.be.false;
					expect(pageInfo.hasPrevious).to.be.true;
					expect(pageInfo.remaining).to.equal(0);
					expect(results).to.deep.equal(expected.slice(10, 20));
					return query.clone().limit(10).cursorPage(pageInfo.next);
				})
				.then(({results, pageInfo}) => {
					expect(pageInfo.hasNext).to.be.false;
					expect(pageInfo.hasPrevious).to.be.true;
					expect(pageInfo.remaining).to.equal(0);
					expect(results).to.deep.equal([]);
					return query.clone().limit(5).previousCursorPage(pageInfo.previous);
				})
				.then(({results, pageInfo}) => {
					expect(pageInfo.hasNext).to.be.false;
					expect(pageInfo.hasPrevious).to.be.true;
					expect(pageInfo.remaining).to.equal(15);
					expect(results).to.deep.equal(expected.slice(15, 20));
					return query.clone().limit(5).previousCursorPage(pageInfo.previous);
				})
				.then(({results, pageInfo}) => {
					expect(pageInfo.hasNext).to.be.true;
					expect(pageInfo.hasPrevious).to.be.true;
					expect(pageInfo.remaining).to.equal(10);
					expect(results).to.deep.equal(expected.slice(10, 15));
					return query.clone().limit(5).previousCursorPage(pageInfo.previous);
				})
				.then(({results, pageInfo}) => {
					expect(pageInfo.hasNext).to.be.true;
					expect(pageInfo.hasPrevious).to.be.true;
					expect(pageInfo.remaining).to.equal(5);
					expect(results).to.deep.equal(expected.slice(5, 10));
					return query.clone().limit(5).previousCursorPage(pageInfo.previous);
				})
				.then(({results, pageInfo}) => {
					expect(pageInfo.hasNext).to.be.true;
					expect(pageInfo.hasPrevious).to.be.false;
					expect(pageInfo.remaining).to.equal(0);
					expect(results).to.deep.equal(expected.slice(0, 5));
					return query.clone().limit(5).previousCursorPage(pageInfo.previous);
				})
				.then(({results, pageInfo}) => {
					expect(pageInfo.hasNext).to.be.true;
					expect(pageInfo.hasPrevious).to.be.false;
					expect(pageInfo.remaining).to.equal(0);
					expect(results).to.deep.equal([]);
					return query.clone().limit(5).cursorPage(pageInfo.next);
				})
				.then(({results, pageInfo}) => {
					expect(pageInfo.hasNext).to.be.true;
					expect(pageInfo.hasPrevious).to.be.false;
					expect(pageInfo.remaining).to.equal(15);
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
						return query.clone().cursorPage(res.pageInfo.next);
					})
					.then(res => {
						expect(res.results).to.deep.equal([]);
						return query.clone().previousCursorPage(res.pageInfo.previous);
					})
					.then(res => {
						expect(res.results).to.deep.equal([]);
						return query.clone().previousCursorPage(res.pageInfo.previous);
					})
					.then(res => {
						expect(res.results).to.deep.equal([]);
					});
		});

		it('handles column name mappers', () => {
			class CaseMovie extends Movie {
				$formatDatabaseJson(json) {
					const formatted = super.$formatDatabaseJson(json);
					return mapKeys(formatted, (val, key) => snakeCase(key));
				}

				$parseDatabaseJson(json) {
					const parsed = super.$parseDatabaseJson(json);
					return mapKeys(parsed, (val, key) => camelCase(key));
				}
			}

			const query = CaseMovie
				.query(knex)
				.orderBy('alt_title')
				.orderBy('id', 'asc')
				.limit(5);

			let expected;

			return query.clone()
				.then(res => {
					expected = res;
					return query.clone().cursorPage();
				})
				.then(({results, pageInfo}) => {
					expect(results).to.deep.equal(expected.slice(0, 5));
					return query.clone().cursorPage(pageInfo.next);
				});
		});
	});

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
});
