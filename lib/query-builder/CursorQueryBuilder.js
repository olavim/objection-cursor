const {castArray} = require('lodash');
const OrderByCoalesceQueryBuilder = require('./OrderByCoalesceQueryBuilder');
const {serializeCursor, deserializeCursor} = require('../serialize');
const {columnToProperty} = require('../convert');
const {getCoalescedOp, lockStatement} = require('../utils');

module.exports = function (options, Base) {
	return class extends OrderByCoalesceQueryBuilder(Base) {
		cursorPage(cursor, before = false) {
			return this
				.runBefore((result, builder) => {
					// Save current builder (before additional where statements) for pageInfo (total)
					const originalQuery = builder.clone()
						.$flag('originalQuery', true)
						.$flag('onBuild', false);

					builder.$data('originalQuery', originalQuery);

					return result;
				})
				.onBuild(builder => lockStatement(builder, 'onBuild', () => {
					this._buildCursor(builder, cursor, before);
				}))
				.runAfter((models, builder) => {
					// We want to always return results in the same order; as if turning pages in a book
					if (before) {
						models.reverse();
					}

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

			return orderByData.map(({column, order = 'asc'}) => ({
				column,
				property: columnToProperty(this.modelClass(), column),
				// If going backward: asc => desc, desc => asc
				order: before === (order.toLowerCase() === 'asc') ? 'desc' : 'asc'
			}));
		}

		_addWhereComposites(builder, composites, item) {
			const orderByCoalesceData = this.$data('orderByCoalesce');
			for (const op of composites) {
				const {column, value} = getCoalescedOp(this, orderByCoalesceData, op, item);
				builder.andWhere(column, value);
			}
		}

		_addWhereStmts(builder, orderByOperations, item, composites = []) {
			if (!item) {
				return;
			}

			if (orderByOperations.length === 0) {
				throw new Error('Invalid cursor');
			}

			const orderByCoalesceData = this.$data('orderByCoalesce');
			const nextOperation = orderByOperations[0];

			const {column, value, order} = getCoalescedOp(this, orderByCoalesceData, nextOperation, item);
			const comp = order === 'asc' ? '>' : '<';

			if (orderByOperations.length === 1) {
				return builder.where(column, comp, value);
			}

			const self = this;
			composites = [nextOperation, ...composites];

			builder.andWhere(function () {
				this.where(column, comp, value);
				this.orWhere(function () {
					self._addWhereComposites(this, composites, item);
					this.andWhere(function () {
						// Add where statements recursively
						self._addWhereStmts(this, orderByOperations.slice(1), item, composites);
					});
				});
			})
		}

		_buildCursor(builder, cursor, before) {
			if (builder.$flag('originalQuery')) {
				return;
			}

			const orderByOps = this._getOrderByOperations(before);
			const item = this._getPartialCursorItem(cursor);

			this._addWhereStmts(builder, orderByOps, item);

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
						return builder.$data('originalQuery').resultSize().then(rs => {
							total = parseInt(rs, 10);
							setIfEnabled('total', total);
						});
					}
				})
				.then(() => {
					if (isEnabled(['hasMore', 'hasNext', 'hasPrevious', 'remaining', 'remainingBefore', 'remainingAfter'])) {
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