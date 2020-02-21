const expect = require('chai').expect;
const {Model, raw} = require('objection');
const {mapKeys, snakeCase, camelCase} = require('lodash');
const cursorPagination = require('..');
const {serializeValue} = require('../lib/type-serializer');

module.exports = knex => {
	describe('cursor tests', () => {
		const cursor = cursorPagination({
			limit: 10,
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

		function test(query, pageSizeRange) {
			const tasks = [];
			for (let pageSize = pageSizeRange[0]; pageSize <= pageSizeRange[1]; pageSize++) {
				let expected;
				let perPage = pageSize;

				let clone = query.clone().then(res => {
					expected = res;
					let q = query.clone().limit(perPage).cursorPage();

					const offsets = [];
					for (let offset = 0; offset < expected.length; offset += pageSize) {
						offsets.push(offset);
					}

					return offsets.reduce(
						(q, offset) => q.then(({results, pageInfo}) => {
							expect(pageInfo.total).to.equal(expected.length);
							const end = Math.min(offset + perPage, expected.length);
							const pageDisplay = `rows: ${offset} - ${end} / ${expected.length}`;

							expect(results, pageDisplay).to.deep.equal(expected.slice(offset, end));
							expect(results.length).to.equal(end - offset);

							return query.clone().limit(end - offset).cursorPage(pageInfo.next);
						}),
						q
					);
				});

				clone = clone
					.then(({pageInfo}) => {
						return query.clone().limit(5).cursorPage(pageInfo.next);
					})
					.then(({results}) => {
						expect(results).to.deep.equal([]);
					});

				tasks.push(clone);
			}
			return Promise.all(tasks);
		}

		it('other where statements', () => {
			const query = Movie
				.query()
				.orderBy('author')
				.orderBy('id')
				.where('title', 'like', 'movie-0%');

			return test(query, [2, 5]);
		});

		it('one order by col', () => {
			const query = Movie
				.query()
				.orderBy('id');

			return test(query, [2, 5]);
		});

		it('two order by cols: asc,desc', () => {
			const query = Movie
				.query()
				.orderByCoalesce('title', 'asc')
				.orderBy('id', 'desc');

			return test(query, [2, 5]);
		});

		it('two order by cols: asc,desc - orderByExplicit', () => {
			const query = Movie
				.query()
				.orderByExplicit(raw('COALESCE(??, ?)', ['title', '']), 'asc')
				.orderBy('id', 'desc');

			return test(query, [2, 5]);
		});

		it('three order by cols: asc,desc,asc', () => {
			const query = Movie
				.query()
				.orderByCoalesce('title', 'asc')
				.orderBy('author', 'desc')
				.orderBy('id', 'asc');

			return test(query, [2, 5]);
		});

		it('three order by cols: asc,desc,asc - orderByExplicit', () => {
			const query = Movie
				.query()
				.orderByExplicit(raw('COALESCE(??, ?)', ['title', '']), 'asc')
				.orderBy('author', 'desc')
				.orderBy('id', 'asc');

			return test(query, [2, 5]);
		});

		it('four order by cols: asc,desc,desc,asc', () => {
			const datetimeType = knex.client.config.client === 'mysql'
				? 'datetime'
				: 'timestamptz';

			const query = Movie
				.query()
				.orderByCoalesce('title', 'asc')
				.orderBy('author', 'desc')
				.orderByCoalesce('date', 'desc', raw(`CAST(? as ${datetimeType})`, '1970-1-1'))
				.orderBy('id', 'asc');

			return test(query, [2, 5]);
		});

		it('four order by cols: asc,desc,desc,asc - orderByExplicit', () => {
			const datetimeType = knex.client.config.client === 'mysql'
				? 'datetime'
				: 'timestamptz';

			const query = Movie
				.query()
				.orderByExplicit(raw('COALESCE(??, ?)', ['title', '']), 'asc')
				.orderBy('author', 'desc')
				.orderByExplicit(raw('COALESCE(??, ?)', ['date', raw(`CAST(? as ${datetimeType})`, '1970-1-1')]), 'desc')
				.orderBy('id', 'asc');

			return test(query, [2, 5]);
		});

		it('go to end, then back to beginning', () => {
			const query = Movie
				.query()
				.orderByCoalesce('title', 'desc')
				.orderBy('id', 'asc');

			let expected;

			return query.clone()
				.then(res => {
					expected = res;
					return query.clone().limit(5).cursorPage();
				})
				.then(({results, pageInfo}) => {
					expect(pageInfo.hasMore).to.be.true;
					expect(pageInfo.hasNext).to.be.true;
					expect(pageInfo.hasPrevious).to.be.false;
					expect(pageInfo.remaining).to.equal(15);
					expect(pageInfo.remainingAfter).to.equal(15);
					expect(pageInfo.remainingBefore).to.equal(0);
					expect(results).to.deep.equal(expected.slice(0, 5));
					return query.clone().limit(5).cursorPage(pageInfo.next);
				})
				.then(({results, pageInfo}) => {
					expect(pageInfo.hasMore).to.be.true;
					expect(pageInfo.hasNext).to.be.true;
					expect(pageInfo.hasPrevious).to.be.true;
					expect(pageInfo.remaining).to.equal(10);
					expect(pageInfo.remainingAfter).to.equal(10);
					expect(pageInfo.remainingBefore).to.equal(5);
					expect(results).to.deep.equal(expected.slice(5, 10));
					return query.clone().limit(10).cursorPage(pageInfo.next);
				})
				.then(({results, pageInfo}) => {
					expect(pageInfo.hasMore).to.be.false;
					expect(pageInfo.hasNext).to.be.false;
					expect(pageInfo.hasPrevious).to.be.true;
					expect(pageInfo.remaining).to.equal(0);
					expect(pageInfo.remainingAfter).to.equal(0);
					expect(pageInfo.remainingBefore).to.equal(10);
					expect(results).to.deep.equal(expected.slice(10, 20));
					return query.clone().limit(10).cursorPage(pageInfo.next);
				})
				.then(({results, pageInfo}) => {
					expect(pageInfo.hasMore).to.be.false;
					expect(pageInfo.hasNext).to.be.false;
					expect(pageInfo.hasPrevious).to.be.true;
					expect(pageInfo.remaining).to.equal(0);
					expect(pageInfo.remainingAfter).to.equal(0);
					expect(pageInfo.remainingBefore).to.equal(20);
					expect(results).to.deep.equal([]);
					return query.clone().limit(5).previousCursorPage(pageInfo.previous);
				})
				.then(({results, pageInfo}) => {
					expect(pageInfo.hasMore).to.be.true;
					expect(pageInfo.hasNext).to.be.false;
					expect(pageInfo.hasPrevious).to.be.true;
					expect(pageInfo.remaining).to.equal(15);
					expect(pageInfo.remainingAfter).to.equal(0);
					expect(pageInfo.remainingBefore).to.equal(15);
					expect(results).to.deep.equal(expected.slice(15, 20));
					return query.clone().limit(5).previousCursorPage(pageInfo.previous);
				})
				.then(({results, pageInfo}) => {
					expect(pageInfo.hasMore).to.be.true;
					expect(pageInfo.hasNext).to.be.true;
					expect(pageInfo.hasPrevious).to.be.true;
					expect(pageInfo.remaining).to.equal(10);
					expect(pageInfo.remainingAfter).to.equal(5);
					expect(pageInfo.remainingBefore).to.equal(10);
					expect(results).to.deep.equal(expected.slice(10, 15));
					return query.clone().limit(5).previousCursorPage(pageInfo.previous);
				})
				.then(({results, pageInfo}) => {
					expect(pageInfo.hasMore).to.be.true;
					expect(pageInfo.hasNext).to.be.true;
					expect(pageInfo.hasPrevious).to.be.true;
					expect(pageInfo.remaining).to.equal(5);
					expect(pageInfo.remainingAfter).to.equal(10);
					expect(pageInfo.remainingBefore).to.equal(5);
					expect(results).to.deep.equal(expected.slice(5, 10));
					return query.clone().limit(5).previousCursorPage(pageInfo.previous);
				})
				.then(({results, pageInfo}) => {
					expect(pageInfo.hasMore).to.be.false;
					expect(pageInfo.hasNext).to.be.true;
					expect(pageInfo.hasPrevious).to.be.false;
					expect(pageInfo.remaining).to.equal(0);
					expect(pageInfo.remainingAfter).to.equal(15);
					expect(pageInfo.remainingBefore).to.equal(0);
					expect(results).to.deep.equal(expected.slice(0, 5));
					return query.clone().limit(5).previousCursorPage(pageInfo.previous);
				})
				.then(({results, pageInfo}) => {
					expect(pageInfo.hasMore).to.be.false;
					expect(pageInfo.hasNext).to.be.true;
					expect(pageInfo.hasPrevious).to.be.false;
					expect(pageInfo.remaining).to.equal(0);
					expect(pageInfo.remainingAfter).to.equal(20);
					expect(pageInfo.remainingBefore).to.equal(0);
					expect(results).to.deep.equal([]);
					return query.clone().limit(5).cursorPage(pageInfo.next);
				})
				.then(({results, pageInfo}) => {
					expect(pageInfo.hasMore).to.be.true;
					expect(pageInfo.hasNext).to.be.true;
					expect(pageInfo.hasPrevious).to.be.false;
					expect(pageInfo.remaining).to.equal(15);
					expect(pageInfo.remainingAfter).to.equal(15);
					expect(pageInfo.remainingBefore).to.equal(0);
					expect(results).to.deep.equal(expected.slice(0, 5));
				});
		});

		it('go to end, then back to beginning - orderByExplicit', () => {
			const query = Movie
				.query()
				.orderByExplicit(raw('COALESCE(??, ?)', ['title', '']), 'desc')
				.orderBy('id', 'asc');

			let expected;

			return query.clone()
				.then(res => {
					expected = res;
					return query.clone().limit(5).cursorPage();
				})
				.then(({results, pageInfo}) => {
					expect(pageInfo.hasMore).to.be.true;
					expect(pageInfo.hasNext).to.be.true;
					expect(pageInfo.hasPrevious).to.be.false;
					expect(pageInfo.remaining).to.equal(15);
					expect(pageInfo.remainingAfter).to.equal(15);
					expect(pageInfo.remainingBefore).to.equal(0);
					expect(results).to.deep.equal(expected.slice(0, 5));
					return query.clone().limit(5).cursorPage(pageInfo.next);
				})
				.then(({results, pageInfo}) => {
					expect(pageInfo.hasMore).to.be.true;
					expect(pageInfo.hasNext).to.be.true;
					expect(pageInfo.hasPrevious).to.be.true;
					expect(pageInfo.remaining).to.equal(10);
					expect(pageInfo.remainingAfter).to.equal(10);
					expect(pageInfo.remainingBefore).to.equal(5);
					expect(results).to.deep.equal(expected.slice(5, 10));
					return query.clone().limit(10).cursorPage(pageInfo.next);
				})
				.then(({results, pageInfo}) => {
					expect(pageInfo.hasMore).to.be.false;
					expect(pageInfo.hasNext).to.be.false;
					expect(pageInfo.hasPrevious).to.be.true;
					expect(pageInfo.remaining).to.equal(0);
					expect(pageInfo.remainingAfter).to.equal(0);
					expect(pageInfo.remainingBefore).to.equal(10);
					expect(results).to.deep.equal(expected.slice(10, 20));
					return query.clone().limit(10).cursorPage(pageInfo.next);
				})
				.then(({results, pageInfo}) => {
					expect(pageInfo.hasMore).to.be.false;
					expect(pageInfo.hasNext).to.be.false;
					expect(pageInfo.hasPrevious).to.be.true;
					expect(pageInfo.remaining).to.equal(0);
					expect(pageInfo.remainingAfter).to.equal(0);
					expect(pageInfo.remainingBefore).to.equal(20);
					expect(results).to.deep.equal([]);
					return query.clone().limit(5).previousCursorPage(pageInfo.previous);
				})
				.then(({results, pageInfo}) => {
					expect(pageInfo.hasMore).to.be.true;
					expect(pageInfo.hasNext).to.be.false;
					expect(pageInfo.hasPrevious).to.be.true;
					expect(pageInfo.remaining).to.equal(15);
					expect(pageInfo.remainingAfter).to.equal(0);
					expect(pageInfo.remainingBefore).to.equal(15);
					expect(results).to.deep.equal(expected.slice(15, 20));
					return query.clone().limit(5).previousCursorPage(pageInfo.previous);
				})
				.then(({results, pageInfo}) => {
					expect(pageInfo.hasMore).to.be.true;
					expect(pageInfo.hasNext).to.be.true;
					expect(pageInfo.hasPrevious).to.be.true;
					expect(pageInfo.remaining).to.equal(10);
					expect(pageInfo.remainingAfter).to.equal(5);
					expect(pageInfo.remainingBefore).to.equal(10);
					expect(results).to.deep.equal(expected.slice(10, 15));
					return query.clone().limit(5).previousCursorPage(pageInfo.previous);
				})
				.then(({results, pageInfo}) => {
					expect(pageInfo.hasMore).to.be.true;
					expect(pageInfo.hasNext).to.be.true;
					expect(pageInfo.hasPrevious).to.be.true;
					expect(pageInfo.remaining).to.equal(5);
					expect(pageInfo.remainingAfter).to.equal(10);
					expect(pageInfo.remainingBefore).to.equal(5);
					expect(results).to.deep.equal(expected.slice(5, 10));
					return query.clone().limit(5).previousCursorPage(pageInfo.previous);
				})
				.then(({results, pageInfo}) => {
					expect(pageInfo.hasMore).to.be.false;
					expect(pageInfo.hasNext).to.be.true;
					expect(pageInfo.hasPrevious).to.be.false;
					expect(pageInfo.remaining).to.equal(0);
					expect(pageInfo.remainingAfter).to.equal(15);
					expect(pageInfo.remainingBefore).to.equal(0);
					expect(results).to.deep.equal(expected.slice(0, 5));
					return query.clone().limit(5).previousCursorPage(pageInfo.previous);
				})
				.then(({results, pageInfo}) => {
					expect(pageInfo.hasMore).to.be.false;
					expect(pageInfo.hasNext).to.be.true;
					expect(pageInfo.hasPrevious).to.be.false;
					expect(pageInfo.remaining).to.equal(0);
					expect(pageInfo.remainingAfter).to.equal(20);
					expect(pageInfo.remainingBefore).to.equal(0);
					expect(results).to.deep.equal([]);
					return query.clone().limit(5).cursorPage(pageInfo.next);
				})
				.then(({results, pageInfo}) => {
					expect(pageInfo.hasMore).to.be.true;
					expect(pageInfo.hasNext).to.be.true;
					expect(pageInfo.hasPrevious).to.be.false;
					expect(pageInfo.remaining).to.equal(15);
					expect(pageInfo.remainingAfter).to.equal(15);
					expect(pageInfo.remainingBefore).to.equal(0);
					expect(results).to.deep.equal(expected.slice(0, 5));
				});
		});

		it('no results', () => {
			const query = Movie
				.query()
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
				.query()
				.orderBy('alt_title')
				.orderBy('id', 'asc');

			return test(query, [2, 5]);
		});

		it('cursorPage does not have to be last call', () => {
			const expectedQuery = Movie.query()
				.orderByCoalesce('title', 'desc')
				.orderBy('id', 'asc');
			const cursorPage = (...args) => Movie.query()
				.cursorPage(...args)
				.orderByCoalesce('title', 'desc')
				.orderBy('id', 'asc')
				.limit(5);

			let expected;

			return expectedQuery
				.then(res => {
					expected = res;
					return cursorPage();
				})
				.then(({results, pageInfo}) => {
					expect(results).to.deep.equal(expected.slice(0, 5));
					return cursorPage(pageInfo.next);
				})
				.then(({results, pageInfo}) => {
					expect(results).to.deep.equal(expected.slice(5, 10));
					return cursorPage(pageInfo.previous, true);
				})
				.then(({results}) => {
					expect(results).to.deep.equal(expected.slice(0, 5));
				});
		});

		it('cursorPage does not have to be last call - orderByExplicit', () => {
			const expectedQuery = Movie.query()
				.orderByExplicit(raw('COALESCE(??, ?)', ['title', '']), 'desc')
				.orderBy('id', 'asc');
			const cursorPage = (...args) => Movie.query()
				.cursorPage(...args)
				.orderByExplicit(raw('COALESCE(??, ?)', ['title', '']), 'desc')
				.orderBy('id', 'asc')
				.limit(5);

			let expected;

			return expectedQuery
				.then(res => {
					expected = res;
					return cursorPage();
				})
				.then(({results, pageInfo}) => {
					expect(results).to.deep.equal(expected.slice(0, 5));
					return cursorPage(pageInfo.next);
				})
				.then(({results, pageInfo}) => {
					expect(results).to.deep.equal(expected.slice(5, 10));
					return cursorPage(pageInfo.previous, true);
				})
				.then(({results}) => {
					expect(results).to.deep.equal(expected.slice(0, 5));
				});
		});

		it('order by [table].[column]', () => {
			const query = Movie
				.query()
				.orderBy('movies.id', 'asc');

			return test(query, [2, 5]);
		});

		it('order by coalesce raw', () => {
			const query = Movie
				.query()
				.orderByCoalesce('title', 'desc', raw('?', ['ab']))
				.orderBy('id', 'asc');

			return test(query, [2, 5]);
		});

		it('order by explicit raw', () => {
			const query = Movie
				.query()
				.orderByExplicit(raw('COALESCE(??, ?)', ['title', raw('?', ['ab'])]), 'desc')
				.orderBy('id', 'asc');

			return test(query, [2, 5]);
		});

		if (knex.client.config.client === 'pg') {
			it('order by explicit raw - case expression', () => {
				const query = Movie
					.query()
					.orderByExplicit(
						raw('CASE WHEN ?? IS NULL THEN ? ELSE ?? END', ['title', '', 'title']),
						'desc',
						val => val || ''
					)
					.orderBy('id', 'asc');

				return test(query, [2, 10]);
			});
		}

		it('order by explicit raw - modified internal data layout', () => {
			class SuperMovie extends Movie {
				$parseDatabaseJson(json) {
					json = super.$parseDatabaseJson(json);
					json.waitWhat = json.title;
					delete json.title;
					return json;
				}
			}

			const query = SuperMovie
				.query()
				.orderByExplicit(raw(`COALESCE(??, '')`, 'title'), 'asc', 'waitWhat')
				.orderBy('id');

			return test(query, [2, 5]);
		});

		if (knex.client.config.client === 'pg') {
			it('order by explicit raw - unknown column name', () => {
				const query = Movie
					.query()
					.orderByExplicit(
						raw('CONCAT(?::TEXT, ??)', ['tmp', 'title']),
						'asc',
						val => 'tmp' + (val || ''),
						'title'
					)
					.orderBy('id');

				return test(query, [2, 5]);
			});
		}

		it('order by date column', () => {
			const query = Movie
				.query()
				.orderBy('createdAt', 'asc')
				.orderBy('id', 'asc');

			return test(query, [2, 5]);
		});

		it('unordered', () => {
			const query = Movie.query();

			let expected;

			return query.clone()
				.then(res => {
					expected = res;
					return query.clone().limit(10).cursorPage();
				})
				.then(({results, pageInfo}) => {
					expect(results).to.deep.equal(expected.slice(0, 10));
					return query.clone().limit(10).cursorPage(pageInfo.next);
				})
				.then(({results}) => {
					expect(results).to.deep.equal(expected.slice(0, 10));
				});
		});

		it('invalid cursor', () => {
			const query = Movie.query();

			return query.clone().cursorPage('what is going on')
				.then(() => expect(true).to.be.false)
				.catch(err => expect(err.message).to.equal('Invalid cursor'));
		});

		it('invalid serialized cursor', () => {
			const query = Movie.query();

			return query.clone().cursorPage(serializeValue('what is going on'))
				.then(() => expect(true).to.be.false)
				.catch(err => expect(err.message).to.equal('Invalid cursor'));
		});
	});
}
