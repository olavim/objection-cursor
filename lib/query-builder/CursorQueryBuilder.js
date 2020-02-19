const {castArray} = require('lodash');
const {ref} = require('objection');
const OrderQueryBuilder = require('./OrderQueryBuilder');
const {serializeCursor, deserializeCursor} = require('../serialize');
const {columnToProperty} = require('../convert');
const {resolveOrderByOperation, lockStatement} = require('../utils');

module.exports = function (options, Base) {
	return class extends OrderQueryBuilder(Base) {
		cursorPage(cursor, before = false) {
			/* We build the actual cursor logic in `runBefore` and `onBuild` handlers to relax the need to
			 * chain operations in a specific order.
			 */
			return this
				.runBefore((result, builder) => {
					/* Save current builder (before additional where statements) for pageInfo. `orderBy` statements
					 * are also invoked in a `runBefore` handler, but since we don't care about their presence
					 * when using the original builder, the order in which these handlers run doesn't matter.
					 */
					const originalQuery = builder.clone()
						.$flag('originalQuery', true)
						.$flag('onBuild', false);

					builder.$data('originalQuery', originalQuery);

					return result;
				})
				.onBuild(builder => lockStatement(builder, 'onBuild', () => {
					/* We want to build the cursor only after the original query has been saved and orderBy
					 * statements have been invoked. This is why we build the cursor in an `onBuild` handler,
					 * which is ran strictly after `runBefore`.
					 */
					this._buildCursor(builder, cursor, before);
				}))
				.runAfter((models, builder) => {
					// We want to always return results in the same order; as if turning pages in a book
					if (before) {
						models.reverse();
					}

					/* When building the cursor, we want to know the values of the properties that the user has
					 * ordered their data by. We build a "partial item" based on those columns to make it easier
					 * to visualize for the developer. For example, if the queried data was something like
					 * {id: 2, title: 'hi', author: 'you'}, and the user ordered their data by `id` and `author`,
					 * then the partial item would be {id: 2, author: 'you'}.
					 */
					const item = this._getPartialCursorItem(cursor);

					/* When we reach end while going forward, save the last element of the last page, but discard
					* first element of last page. If we try to go forward, we get an empty result, because
					* there are no elements after the last one. If we go back from there, we get results for
					* the last page. The opposite is true when going backward from the first page.
					*/
					const first = models.length > 0 ? models[0] : (before ? item : null);
					const last = models.length > 0 ? models[models.length - 1] : (before ? null : item);
					const orderByOps = this._getOrderByOperations(before);

					return this._getAdditionalPageInfo(models, builder, before)
						.then(additionalPageInfo => ({
							results: models,
							pageInfo: Object.assign(additionalPageInfo, {
								next: serializeCursor(orderByOps, last),
								previous: serializeCursor(orderByOps, first)
							})
						}));
				});
		}

		nextCursorPage(cursor) {
			return this.cursorPage(cursor, false);
		}

		previousCursorPage(cursor) {
			return this.cursorPage(cursor, true);
		}

		_getPartialCursorItem(cursor) {
			// Direction doesn't matter here, since we only want to know if a column exists
			const orderByOps = this._getOrderByOperations();

			// Get partial item from cursor
			return deserializeCursor(orderByOps, cursor);
		}

		_getOrderByOperations(before = false) {
			const orderByData = this.$data('orderBy') || [];
			const orderByExplicitData = this.$data('orderByExplicit') || {};

			return orderByData.map(({column, order = 'asc'}) => ({
				column,
				property: columnToProperty(this.modelClass(), orderByExplicitData[column] ? ref(column) : column),
				// If going backward: asc => desc, desc => asc
				order: before === (order.toLowerCase() === 'asc') ? 'desc' : 'asc'
			}));
		}

		/**
		 * Recursive procedure to build where statements needed to get rows before/after some given item (row).
		 *
		 * Let's say we want to order by columns [c1, c2, c3], all in ascending order for simplicity.
		 * The resulting structure looks like this:
		 *
		 * - If c1 > value, return row
		 * - Otherwise, if c1 = value and c2 > value, return row
		 * - Otherwise, if c1 = value and c2 = value and c3 > value, return row
		 * - Otherwise, do not return row
		 *
		 * Comparisons are simply flipped if order is 'desc', and Objection knows to compare columns to
		 * nulls correctly with "column IS NULL" instead of "column = NULL".
		 */
		_addWhereStmts(builder, orderByOperations, item, composites = []) {
			if (!item) {
				return;
			}

			const orderByOp = orderByOperations[0];
			composites = [orderByOp, ...composites];

			const orderByExplicitData = this.$data('orderByExplicit');

			const {column, value} = resolveOrderByOperation(orderByExplicitData, orderByOp, item);
			const comp = orderByOp.order === 'asc' ? '>' : '<';

			const self = this;

			builder.andWhere(function () {
				this.where(column, comp, value);

				if (orderByOperations.length > 1) {
					this.orWhere(function () {
						for (const op of composites) {
							const {column, value} = resolveOrderByOperation(orderByExplicitData, op, item);
							this.andWhere(column, value);
						}

						this.andWhere(function () {
							// Add where statements recursively
							self._addWhereStmts(this, orderByOperations.slice(1), item, composites);
						});
					});
				}
			});
		}

		_buildCursor(builder, cursor, before) {
			if (builder.$flag('originalQuery')) {
				return;
			}

			const orderByOps = this._getOrderByOperations(before);
			const item = this._getPartialCursorItem(cursor);

			this._addWhereStmts(builder, orderByOps, item);

			// Add default limit unless we are in the process of calculating total rows
			if (!builder.has(/limit/) && !builder.$flag('resultSizeQuery')) {
				builder.limit(options.limit);
			}

			// Swap orderBy directions when going backward
			if (before) {
				builder.forEachOperation(/orderBy/, op => {
					op.args[1] = op.args[1] === 'asc' ? 'desc' : 'asc';
				});
			}

			// Save copy of current builder for pageInfo (hasNext, remaining, etc.)
			const resultSizeQuery = builder.clone()
				.$flag('resultSizeQuery', true)
				.$flag('onBuild', false);

			builder.$data('resultSizeQuery', resultSizeQuery);
		}

		_getAdditionalPageInfo(models, builder, before) {
			const pageInfo = {};

			// Check if at least one given option is enabled
			const isEnabled = opts => castArray(opts).some(key => options.pageInfo[key]);
			const setIfEnabled = (key, val) => {
				pageInfo[key] = options.pageInfo[key] ? val : undefined;
			}

			let total;

			return Promise.resolve()
				.then(() => {
					if (isEnabled(['total', 'hasNext', 'hasPrevious', 'remainingBefore', 'remainingAfter'])) {
						// Count number of rows without where statements or limits
						return builder.$data('originalQuery').resultSize().then(rs => {
							total = parseInt(rs, 10);
							setIfEnabled('total', total);
						});
					}
				})
				.then(() => {
					if (isEnabled(['hasMore', 'hasNext', 'hasPrevious', 'remaining', 'remainingBefore', 'remainingAfter'])) {
						/* Count number of rows without limits, but retain where statements to count rows
						 * only in one direction. I.e. get number of rows before/after current results.
						 */
						return builder.$data('resultSizeQuery').resultSize().then(rs => {
							const remaining = rs - models.length;
							setIfEnabled('remaining', remaining);
							setIfEnabled('remainingBefore', before ? remaining : total - rs);
							setIfEnabled('remainingAfter', before ? total - rs : remaining);
							setIfEnabled('hasMore', remaining > 0);
							setIfEnabled('hasPrevious', (before && remaining > 0) || (!before && total - rs > 0));
							setIfEnabled('hasNext', (!before && remaining > 0) || (before && total - rs > 0));
						});
					}
				})
				.then(() => pageInfo);
		}
	}
}