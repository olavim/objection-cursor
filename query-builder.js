const {castArray} = require('lodash');
const {serializeCursor, deserializeCursor} = require('./lib/serialize');
const {columnToProperty} = require('./lib/convert');
const {stringifyObjectionBuilder, getCoalescedOp, lockStatement} = require('./lib/utils');

const FLAG_ONBUILD = '__cursor_flag_onBuild';
const FLAG_ONBUILD_ORDERBY = '__cursor_flag_onBuild_orderBy';
const FLAG_ORIGINAL_BUILDER = '__cursor_flag_original_builder';
const FLAG_CURSORPAGE = '__cursor_flag_cursorPage';
const FLAG_ORDERBY = '__cursor_flag_orderBy';
const FLAG_ORDERBYCOALESCE = '__cursor_flag_orderByCoalesce';

const DATA_ORDERBY = '__cursor_data_orderBy';
const DATA_ORDERBYCOALESCE = '__cursor_data_orderByCoalesce';
const DATA_ORIGQUERY = '__cursor_data_originalQueryBuilder';

module.exports = function (options, Base) {
	return class extends Base.QueryBuilder {
		orderBy(col, dir = 'asc') {
			if (this.context()[FLAG_ONBUILD] || this.context()[FLAG_ONBUILD_ORDERBY]) {
				// orderBy was called from an onBuild handler
				return super.orderBy(col, dir);
			}

			const orderByData = this.context()[DATA_ORDERBY] || [];
			this.mergeContext({
				[FLAG_ORDERBY]: true,
				[DATA_ORDERBY]: [...orderByData, {col, dir}]
			});

			return this
				.onBuild(builder => {
					// If `cursorPage` was not called, add orderBy statements here
					if (!builder.context()[FLAG_CURSORPAGE]) {
						this._buildOrderBy(builder);
					}
				});
		}

		orderByCoalesce(col, dir = 'asc', coalesceValues = ['']) {
			const orderByData = this.context()[DATA_ORDERBY] || [];

			this.mergeContext({
				[FLAG_ORDERBYCOALESCE]: true,
				[DATA_ORDERBY]: [...orderByData, {col, dir}],
				[DATA_ORDERBYCOALESCE]: Object.assign({}, this.context()[DATA_ORDERBYCOALESCE], {
					[columnToProperty(this.modelClass(), col)]: castArray(coalesceValues)
				})
			});

			return this
				.onBuild(builder => {
					// If `orderBy` or `cursorPage` was not called, add orderBy statements here
					if (!builder.context()[FLAG_ORDERBY] && !builder.context()[FLAG_CURSORPAGE]) {
						this._buildOrderBy(builder);
					}
				});
		}

		cursorPage(cursor, before = false) {
			return this
				.mergeContext({[FLAG_CURSORPAGE]: true})
				.onBuild(builder => lockStatement(builder, FLAG_ONBUILD, () => {
					return this._buildCursor(builder, cursor, before);
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

		_getOrderByOperations(before) {
			const orderByData = this.context()[DATA_ORDERBY] || [];

			return orderByData.map(({col, dir = 'asc'}) => ({
				col,
				prop: columnToProperty(this.modelClass(), col),
				// If going backward: asc => desc, desc => asc
				dir: before === (dir.toLowerCase() === 'asc') ? 'desc' : 'asc'
			}));
		}

		_addWhereStmts(builder, ops, item, composites = []) {
			if (!item) {
				return;
			}

			if (ops.length === 0) {
				throw new Error('Invalid cursor');
			}

			const {col, val, dir} = getCoalescedOp(this, builder.context()[DATA_ORDERBYCOALESCE], ops[0], item);
			const comp = dir === 'asc' ? '>' : '<';

			if (ops.length === 1) {
				return builder.where(col, comp, val);
			}

			const self = this;
			composites = [ops[0], ...composites];

			builder.andWhere(function () {
				this.where(col, comp, val);
				this.orWhere(function () {
					self._addWhereComposites(this, composites, item);
					this.andWhere(function () {
						// Add where statements recursively
						self._addWhereStmts(this, ops.slice(1), item, composites);
					});
				});
			})
		}

		_addWhereComposites(builder, composites, item) {
			const orderByCoalesceData = builder.context()[DATA_ORDERBYCOALESCE];
			for (const op of composites) {
				const {col, val} = getCoalescedOp(this, orderByCoalesceData, op, item);
				builder.andWhere(col, val);
			}
		}

		_buildOrderBy(builder) {
			lockStatement(builder, FLAG_ONBUILD_ORDERBY, () => {
				const ctx = builder.context();
				const model = this.modelClass();
				const orderByData = ctx[DATA_ORDERBY] || [];
				const orderByCoalesceData = ctx[DATA_ORDERBYCOALESCE];

				for (let {col, dir} of orderByData) {
					const coalesceValues = orderByCoalesceData
						? orderByCoalesceData[columnToProperty(model, col)]
						: null;

					if (coalesceValues) {
						const mappedCoalesce = coalesceValues.map(val => stringifyObjectionBuilder(builder, val));
						const colStr = stringifyObjectionBuilder(builder, col);

						const coalesceBindingsStr = coalesceValues.map(() => '?').join(', ');

						builder.orderBy(
							model.raw(`COALESCE(??, ${coalesceBindingsStr})`, [colStr].concat(mappedCoalesce)),
							dir
						);
					} else {
						builder.orderBy(col, dir);
					}
				}
			});
		}

		_buildCursor(builder, cursor, before) {
			// Save current builder (before where statements) for pageInfo (total, remaining, etc.)
			builder.mergeContext({
				[DATA_ORIGQUERY]: builder.clone().mergeContext({[FLAG_ORIGINAL_BUILDER]: true})
			});

			const orderByOps = this._getOrderByOperations(before);
			const item = this._getPartialCursorItem(cursor);

			this._buildOrderBy(builder);
			this._addWhereStmts(builder, orderByOps, item);

			if (!builder.has(/limit/)) {
				builder.limit(options.limit);
			}

			// Swap orderBy directions when going backward
			if (before) {
				builder.forEachOperation(/orderBy/, op => {
					op.args[1] = op.args[1] === 'asc' ? 'desc' : 'asc';
				});
			}
		}

		_getAdditionalPageInfo(models, builder, before) {
			const pageInfo = {};

			// Check if at least one given option is enabled
			const isEnabled = opts => castArray(opts).some(opt => options.pageInfo[opt]);
			const setIfEnabled = (opt, val) => {
				pageInfo[opt] = options.pageInfo[opt] ? val : undefined;
			}

			let total;

			return Promise.resolve()
				.then(() => {
					if (isEnabled(['total', 'hasNext', 'hasPrevious', 'remainingBefore', 'remainingAfter'])) {
						return builder.context()[DATA_ORIGQUERY].resultSize().then(rs => {
							total = parseInt(rs, 10);
							setIfEnabled('total', total);
						});
					}
				})
				.then(() => {
					if (isEnabled(['hasMore', 'hasNext', 'hasPrevious', 'remaining', 'remainingBefore', 'remainingAfter'])) {
						return this.clone().resultSize().then(rs => {
							rs = parseInt(rs, 10);
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