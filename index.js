const {get, castArray} = require('lodash');
const {serializeCursor, deserializeCursor} = require('./lib/serialize');
const {columnToProperty} = require('./lib/convert');

const FLAG_ONBUILD = '__cursor_flag_onBuild';
const FLAG_ONBUILD_ORDERBY = '__cursor_flag_onBuild_orderBy';

const FLAG_ORIGINAL_BUILDER = '__cursor_flag_original_builder';
const FLAG_CURSORPAGE = '__cursor_flag_cursorPage';
const FLAG_ORDERBY = '__cursor_flag_orderBy';
const FLAG_ORDERBYCOALESCE = '__cursor_flag_orderByCoalesce';

const DATA_ORDERBY = '__cursor_data_orderBy';
const DATA_ORDERBYCOALESCE = '__cursor_data_orderByCoalesce';

function stringifyObjectionBuilder(builder, val) {
	if (val && typeof val.toKnexRaw === 'function') {
		// Stringify raw- and reference builders, since `Model.raw` doesn't do it
		try {
			return val.toKnexRaw(builder); // Objection v1
		} catch (_err) {
			return val.toKnexRaw(builder.knex()); // Objection v0
		}
	}

	return val;
}

function getCoalescedOp(builder, coalesceObj = {}, {col, prop, dir}, item) {
	let val = get(item, prop, null);

	if (coalesceObj[prop]) {
		const model = builder.modelClass();
		const mappedCoalesce = coalesceObj[prop].map(v => stringifyObjectionBuilder(builder, v));
		const coalesceBindingsStr = mappedCoalesce.map(() => '?');
		col = stringifyObjectionBuilder(builder, col);
		val = stringifyObjectionBuilder(builder, val);
		col = model.raw(`COALESCE(??, ${coalesceBindingsStr})`, [col].concat(mappedCoalesce));
		val = model.raw(`COALESCE(?, ${coalesceBindingsStr})`, [val].concat(mappedCoalesce));
	}

	return {col, prop, val, dir};
}

const mixin = options => {
	options = Object.assign({limit: 50}, options);

	options.pageInfo = Object.assign(
		{
			total: false,
			remaining: false,
			remainingBefore: false,
			remainingAfter: false,
			hasNext: false,
			hasPrevious: false
		},
		options.pageInfo
	);

	return Base => {
		class CursorQueryBuilder extends Base.QueryBuilder {
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
				let origBuilder;
				let orderByOps;
				let item;

				this.mergeContext({[FLAG_CURSORPAGE]: true});

				return this
					.onBuild(builder => {
						const ctx = () => builder.context();

						if (!ctx()[FLAG_ONBUILD] && !ctx()[FLAG_ORIGINAL_BUILDER]) {
							builder.mergeContext({[FLAG_ONBUILD]: true});

							this._buildOrderBy(builder);

							// Save current builder (before where statements) for pageInfo (total, remaining, etc.)
							origBuilder = builder.clone().mergeContext({[FLAG_ORIGINAL_BUILDER]: true});

							if (!builder.has(/limit/)) {
								builder.limit(options.limit);
							}

							orderByOps = this._getOrderByOperations(before);

							// Get partial item from cursor
							item = deserializeCursor(orderByOps, cursor);
							this._addWhereStmts(builder, orderByOps, item);

							// Swap orderBy directions when going backward
							if (before) {
								builder.forEachOperation(/orderBy/, op => {
									op.args[1] = op.args[1] === 'asc' ? 'desc' : 'asc';
								});
							}

							builder.mergeContext({[FLAG_ONBUILD]: false});
						}
					})
					.runAfter(models => {
						// We want to always return results in the same order; as if turning pages in a book
						if (before) {
							models.reverse();
						}

						/* When we reach end while going forward, save the last element of the last page, but discard
						* first element of last page. If we try to go forward, we get an empty result, because
						* there are no elements after the last one. If we go back from there, we get results for
						* the last page. The opposite is true when going backward from the first page.
						*/
						const first = models.length > 0 ? models[0] : (before ? item : null);
						const last = models.length > 0 ? models[models.length - 1] : (before ? null : item);

						const res = {
							results: models,
							pageInfo: {
								next: serializeCursor(orderByOps, last),
								previous: serializeCursor(orderByOps, first)
							}
						};

						let total;
						const info = options.pageInfo;

						// Check if at least one given option is enabled
						const isEnabled = opts => castArray(opts).some(opt => info[opt]);

						const setIfEnabled = (opt, val) => {
							res.pageInfo[opt] = info[opt] ? val : res.pageInfo[opt];
						}

						return Promise.resolve()
							.then(() => {
								if (isEnabled(['total', 'hasNext', 'hasPrevious', 'remainingBefore', 'remainingAfter'])) {
									return origBuilder.resultSize().then(rs => {
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
							.then(() => res);
					});
			}

			nextCursorPage(cursor) {
				return this.cursorPage(cursor, false);
			}

			previousCursorPage(cursor) {
				return this.cursorPage(cursor, true);
			}

			_getOrderByOperations(before) {
				return this.context()[DATA_ORDERBY].map(({col, dir = 'asc'}) => {
					return {
						col,
						prop: columnToProperty(this.modelClass(), col),
						// If going backward: asc => desc, desc => asc
						dir: before === (dir.toLowerCase() === 'asc') ? 'desc' : 'asc'
					};
				});
			}

			_addWhereStmts(builder, ops, item, composites = []) {
				if (!item) {
					return;
				}

				if (ops.length === 0 || (ops.length === 1 && ops[0].val === null)) {
					return builder.where(false);
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
				for (const op of composites) {
					const {col, val} = getCoalescedOp(this, builder.context()[DATA_ORDERBYCOALESCE], op, item);
					builder.andWhere(col, val);
				}
			}

			_buildOrderBy(builder) {
				const ctx = builder.context();
				if (!ctx[FLAG_ONBUILD_ORDERBY]) {
					builder.mergeContext({[FLAG_ONBUILD_ORDERBY]: true});

					if (ctx[DATA_ORDERBYCOALESCE]) {
						for (let {col, dir} of ctx[DATA_ORDERBY]) {
							const model = this.modelClass();
							const coalesce = ctx[DATA_ORDERBYCOALESCE][columnToProperty(model, col)];

							if (coalesce) {
								const mappedCoalesce = coalesce.map(val => stringifyObjectionBuilder(builder, val));
								const colStr = stringifyObjectionBuilder(builder, col);

								const coalesceBindingsStr = coalesce.map(() => '?').join(', ');

								builder.orderBy(
									model.raw(`COALESCE(??, ${coalesceBindingsStr})`, [colStr].concat(mappedCoalesce)),
									dir
								)
							} else {
								builder.orderBy(col, dir);
							}
						}
					} else {
						for (let {col, dir} of ctx[DATA_ORDERBY]) {
							builder.orderBy(col, dir);
						}
					}

					builder.mergeContext({[FLAG_ONBUILD_ORDERBY]: false});
				}
			}
		}

		return class extends Base {
			static get QueryBuilder() {
				return CursorQueryBuilder;
			}
		};
	}
}

module.exports = (options = {}) => {
	if (typeof options === 'function') {
		return mixin({})(options);
	}

	return mixin(options);
};
