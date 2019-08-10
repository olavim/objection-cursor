const {get} = require('lodash');
const {serializeCursor, deserializeCursor} = require('./lib/serialize');
const {columnToProperty} = require('./lib/convert');

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

function getCoalescedOp(builder, coalesceObj = {}, {col, prop, val, dir}) {
	if (coalesceObj[prop]) {
		const model = builder.modelClass();
		const mappedCoalesce = coalesceObj[prop].map(val => stringifyObjectionBuilder(builder, val));
		const coalesceBindingsStr = mappedCoalesce.map(() => '?');
		col = stringifyObjectionBuilder(builder, col);
		val = stringifyObjectionBuilder(builder, val);
		col = model.raw(`COALESCE(??, ${coalesceBindingsStr})`, [col].concat(mappedCoalesce));
		val = model.raw(`COALESCE(?, ${coalesceBindingsStr})`, [val].concat(mappedCoalesce));
	}

	return {col, prop, val, dir};
}

function addWhereComposites(origBuilder, builder, composites, ctx) {
	for (const op of composites) {
		const {col, val} = getCoalescedOp(origBuilder, ctx.coalesce, op);
		builder.andWhere(col, val);
	}
}

function addWhereStmts(origBuilder, builder, ops, composites, ctx) {
	if (ops.length === 0 || (ops.length === 1 && ops[0].val === null)) {
		return builder.where(false);
	}

	const {col, val, dir} = getCoalescedOp(origBuilder, ctx.coalesce, ops[0]);
	const comp = dir === 'asc' ? '>' : '<';

	if (ops.length === 1) {
		return builder.where(col, comp, val);
	}

	composites = [ops[0], ...composites];

	builder.andWhere(function () {
		this.where(col, comp, val);
		this.orWhere(function () {
			addWhereComposites(origBuilder, this, composites, ctx);
			this.andWhere(function () {
				// Add where statements recursively
				addWhereStmts(origBuilder, this, ops.slice(1), composites, ctx);
			});
		});
	})
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
			/* Objection converts reference builders to raw builders, so to support references,
			 * we need to save the reference builder.
			 */
			orderBy(col, dir = 'asc') {
				const ctx = this.context();

				if (ctx.coalesceBuilding || ctx.orderByBuilding) {
					return super.orderBy(col, dir);
				} else {
					const orderBy = ctx.orderBy || [];
					orderBy.push({col, dir});
					this.mergeContext({orderBy});
				}

				return this
					.onBuild(builder => {
						if (!builder.context().coalesce && !builder.context().orderByBuilding) {
							builder.mergeContext({orderByBuilding: true});

							for (let {col, dir} of builder.context().orderBy) {
								builder.orderBy(col, dir);
							}

							builder.mergeContext({orderByBuilding: false});
						}
					});
			}

			orderByCoalesce(col, dir = 'asc', coalesceValues = ['']) {
				const orderBy = this.context().orderBy || [];
				orderBy.push({col, dir});
				this.mergeContext({orderBy});

				const model = this.modelClass();

				if (!Array.isArray(coalesceValues)) {
					coalesceValues = [coalesceValues];
				}

				this.mergeContext({
					coalesce: Object.assign({}, this.context().coalesce, {
						[columnToProperty(model, col)]: coalesceValues
					}),
					onBuildOrderByCoalesce: builder => {
						const context = builder.context();
						builder.mergeContext({coalesceBuilding: true});

						for (let {col, dir} of context.orderBy) {
							const coalesce = context.coalesce[columnToProperty(model, col)];

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

						builder.mergeContext({coalesceBuilding: false});
					}
				});

				return this
					.onBuild(builder => {
						// If `cursorPage` was not called, add order by -statements here
						if (!builder.context().cursorPage) {
							builder.context().onBuildOrderByCoalesce(builder);
						}
					});
			}

			cursorPage(cursor, before = false) {
				let origBuilder;
				let orderByOps;
				let item;

				this.mergeContext({
					cursorPage: true, // Flag notifying that `cursorPage` was called
					before
				});

				return this
					.onBuild(builder => {
						const ctx = () => builder.context();

						if (!ctx().cursorBuilding && !ctx().origBuilder) {
							builder.mergeContext({cursorBuilding: true});

							if (ctx().onBuildOrderByCoalesce) {
								ctx().onBuildOrderByCoalesce(builder);
							}

							origBuilder = builder.clone().mergeContext({origBuilder: true});

							if (!builder.has(/limit/)) {
								builder.limit(options.limit);
							}

							orderByOps = ctx().orderBy.map(({col, dir}) => ({
								col,
								prop: columnToProperty(this.modelClass(), col),
								dir: (dir || 'asc').toLowerCase()
							}));

							if (before) {
								builder.forEachOperation(/orderBy/, op => {
									op.args[1] = op.args[1] === 'asc' ? 'desc' : 'asc';
								});
							}

							// Get partial item from cursor
							item = deserializeCursor(orderByOps, cursor);

							if (item) {
								addWhereStmts(
									builder,
									builder,
									orderByOps.map(({col, prop, dir}) => ({
										col,
										prop,
										// If going backward: asc => desc, desc => asc
										dir: before === (dir === 'asc') ? 'desc' : 'asc',
										val: get(item, prop, null)
									})),
									[],
									ctx()
								);
							}

							builder.mergeContext({cursorBuilding: false});
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
						const isEnabled = opts => {
							opts = Array.isArray(opts) ? opts : [opts];
							return opts.some(opt => info[opt]);
						}

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
