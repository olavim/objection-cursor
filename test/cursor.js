const expect = require('chai').expect;
const Model = require('objection').Model;
const {mapKeys, snakeCase, camelCase} = require('lodash');
const cursorPagination = require('..');

module.exports = knex => {
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

		it('order by [table].[column]', () => {
			const query = Movie
				.query(knex)
				.orderBy('movies.id', 'asc')
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
}
