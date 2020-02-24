import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {Model, raw} from 'objection';
import {mapKeys, snakeCase, camelCase} from 'lodash';
import cursorPagination from '..';
import {serializeValue} from '../lib/type-serializer';

chai.use(chaiAsPromised);
const {expect} = chai;

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

		function keysetKeys(query) {
			const keys = [];
			query.forEachOperation(/orderBy/, op => {
				keys.push(op.args[3] || op.args[0]);
			});
			return keys;
		}

		function mapResults(query, results) {
			const keys = keysetKeys(query);
			return results.map(r => {
				return keys.map(k => r[k]).join(', ');
			});
		}

		// Test query on different page sizes by going from first to last page, and then back.
		async function test(query, pageSizeRange) {
			const totalExpected = await query.clone();

			const pageSizes = [...Array(pageSizeRange[1] - pageSizeRange[0] + 1)].map((_, i) => i + pageSizeRange[0]);

			return Promise.all(
				pageSizes.map(async pageSize => {
					let cursor;

					for (let offset = 0; offset < totalExpected.length; offset += pageSize) {
						const end = Math.min(offset + pageSize, totalExpected.length);

						const {results, pageInfo} = await query.clone().limit(end - offset).cursorPage(cursor);

						const expected = mapResults(query, results);
						const actual = mapResults(query, totalExpected.slice(offset, end));
						const pageDisplay = `rows: ${offset} - ${end} / ${totalExpected.length}`;

						expect(results.length, pageDisplay).to.equal(end - offset);
						expect(pageInfo.total, pageDisplay).to.equal(totalExpected.length);
						expect(pageInfo.remaining, pageDisplay).to.equal(totalExpected.length - end);
						expect(pageInfo.remainingAfter, pageDisplay).to.equal(totalExpected.length - end);
						expect(pageInfo.remainingBefore, pageDisplay).to.equal(offset);
						expect(pageInfo.hasMore, pageDisplay).to.equal(end < totalExpected.length);
						expect(pageInfo.hasNext, pageDisplay).to.equal(end < totalExpected.length);
						expect(pageInfo.hasPrevious, pageDisplay).to.equal(offset > 0);
						expect(expected, pageDisplay).to.deep.equal(actual);

						cursor = pageInfo.next;
					}

					const resEnd = await query.clone().limit(5).cursorPage(cursor);
					expect(resEnd.results).to.deep.equal([]);

					cursor = resEnd.pageInfo.previous;

					for (let end = totalExpected.length; end >= 0; end -= pageSize) {
						const offset = Math.max(0, end - pageSize);

						const {results, pageInfo} = await query.clone().limit(end - offset).previousCursorPage(cursor);

						const expected = mapResults(query, results);
						const actual = mapResults(query, totalExpected.slice(offset, end));
						const pageDisplay = `rows: ${offset} - ${end} / ${totalExpected.length}`;

						expect(results.length, pageDisplay).to.equal(end - offset);
						expect(pageInfo.total, pageDisplay).to.equal(totalExpected.length);
						expect(pageInfo.remaining, pageDisplay).to.equal(offset);
						expect(pageInfo.remainingAfter, pageDisplay).to.equal(totalExpected.length - end);
						expect(pageInfo.remainingBefore, pageDisplay).to.equal(offset);
						expect(pageInfo.hasMore, pageDisplay).to.equal(offset > 0);
						expect(pageInfo.hasNext, pageDisplay).to.equal(end < totalExpected.length);
						expect(pageInfo.hasPrevious, pageDisplay).to.equal(offset > 0);
						expect(expected, pageDisplay).to.deep.equal(actual);

						cursor = pageInfo.previous;
					}

					const resStart = await query.clone().limit(5).previousCursorPage(cursor);
					expect(resStart.results).to.deep.equal([]);
				})
			);
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

		it('cursorPage does not have to be last call - orderByExplicit', async () => {
			const cursorPage = async (...args) => Movie.query()
				.cursorPage(...args)
				.orderByExplicit(raw('COALESCE(??, ?)', ['title', '']), 'desc')
				.orderBy('id', 'asc')
				.limit(5);

			const expected = await Movie.query()
				.orderByExplicit(raw('COALESCE(??, ?)', ['title', '']), 'desc')
				.orderBy('id', 'asc');

			let res = await cursorPage();
			expect(res.results).to.deep.equal(expected.slice(0, 5));
			res = await cursorPage(res.pageInfo.next);
			expect(res.results).to.deep.equal(expected.slice(5, 10));
			res = await cursorPage(res.pageInfo.previous, true);
			expect(res.results).to.deep.equal(expected.slice(0, 5));
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

		it('unordered', async () => {
			const query = Movie.query();

			const expected = await query.clone();
			let res = await query.clone().limit(10).cursorPage();
			expect(res.results).to.deep.equal(expected.slice(0, 10));
			res = await query.clone().limit(10).cursorPage(res.pageInfo.next);
			expect(res.results).to.deep.equal(expected.slice(0, 10));
		});

		it('invalid cursor', () => {
			const query = Movie.query().cursorPage('what is going on');
			expect(query).to.be.rejectedWith(TypeError, 'Invalid cursor');
		});

		it('invalid serialized cursor', async () => {
			const query = Movie.query().cursorPage(serializeValue('what is going on'));
			expect(query).to.be.rejectedWith(TypeError, 'Invalid cursor');
		});
	});
}
