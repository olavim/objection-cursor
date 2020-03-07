import chai, {expect} from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {Model} from 'objection';
import cursorPagination from '../../';
import {serializeValue} from '../../lib/type-serializer';
import orderByTests from './order-by';
import orderByCoalesceTests from './order-by-coalesce';
import orderByExplicitTests from './order-by-explicit';
import columnNameMapperTests from './column-name-mappers';
import mixinComposingTests from './mixin-composing';

chai.use(chaiAsPromised);

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

	describe('query builder', () => {
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

		it('wrong ordering', async () => {
			const res1 = await Movie.query()
				.orderBy('id')
				.cursorPage();

			const query = Movie.query()
				.orderBy('title')
				.orderBy('id')
				.cursorPage(res1.pageInfo.next);

			expect(query).to.be.rejectedWith(Error, 'Cursor does not match ordering');
		});

		orderByTests(knex);
		orderByCoalesceTests(knex);
		orderByExplicitTests(knex);
		columnNameMapperTests(knex);
		mixinComposingTests(knex);
	});
};
