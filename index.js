const {get} = require('lodash');
const {serializeCursor, deserializeCursor} = require('./lib/serialize');
const {columnToProperty} = require('./lib/convert');

function stringifyObjectionBuilder(model, val) {
	// Stringify raw- and reference builders, since `Model.raw` doesn't do it
	return val && typeof val.toKnexRaw === 'function'
		? val.toKnexRaw(model.knex())
		: val;
}

function getCoalescedOp(model, coalesceObj = {}, {col, prop, val, dir}) {
	if (coalesceObj[prop]) {
		const mappedCoalesce = coalesceObj[prop].map(val => stringifyObjectionBuilder(model, val));
		const coalesceBindingsStr = mappedCoalesce.map(() => '?');
		col = stringifyObjectionBuilder(model, col);
		val = stringifyObjectionBuilder(model, val);
		col = model.raw(`COALESCE(??, ${coalesceBindingsStr})`, [col].concat(mappedCoalesce));
		val = model.raw(`COALESCE(?, ${coalesceBindingsStr})`, [val].concat(mappedCoalesce));
	}

	return {col, prop, val, dir};
}

function addWhereComposites(model, builder, composites, ctx) {
	for (const op of composites) {
		const {col, val} = getCoalescedOp(model, ctx.coalesce, op);
		builder.andWhere(col, val);
	}
}

function addWhereStmts(model, builder, ops, composites, ctx) {
	if (ops.length === 0 || (ops.length === 1 && ops[0].val === null)) {
		return builder.where(false);
	}

	const {col, val, dir} = getCoalescedOp(model, ctx.coalesce, ops[0]);
	const comp = dir === 'asc' ? '>' : '<';

	if (ops.length === 1) {
		return builder.where(col, comp, val);
	}

	composites = [ops[0], ...composites];

	builder.andWhere(function () {
		this.where(col, comp, val);
		this.orWhere(function () {
			addWhereComposites(model, this, composites, ctx);
			this.andWhere(function () {
				// Add where statements recursively
				addWhereStmts(model, this, ops.slice(1), composites, ctx);
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
				super.orderBy(col, dir);

				if (!this.context().coalesceBuilding) {
					const orderBy = this.context().orderBy || [];
					orderBy.push({col, dir});
					this.mergeContext({orderBy});
				}

				return this;
			}

			orderByCoalesce(col, dir = 'asc', coalesceValues = ['']) {
				this.orderBy(col, dir);

				const model = this.modelClass();

				if (!Array.isArray(coalesceValues)) {
					coalesceValues = [coalesceValues];
				}

				this.mergeContext({
					coalesce: Object.assign({}, this.context().coalesce, {
						[columnToProperty(model, col)]: coalesceValues
					})
				});

				return this.onBuild(builder => {
					const context = builder.context();
					builder.mergeContext({coalesceBuilding: true});
					builder.clear(/orderBy/);

					for (let {col, dir} of context.orderBy) {
						const coalesce = context.coalesce[columnToProperty(model, col)];

						if (context.before) {
							dir = dir === 'asc' ? 'desc' : 'asc';
						}

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
				});
			}

			cursorPage(cursor, before = false) {
				const origBuilder = this.clone();
				this.mergeContext({before});

				if (!this.has(/limit/)) {
					this.limit(options.limit);
				}

				const orderByOps = this.context().orderBy.map(({col, dir}) => ({
					col,
					prop: columnToProperty(this.modelClass(), col),
					dir: (dir || 'asc').toLowerCase()
				}));

				if (before) {
					this.forEachOperation(/orderBy/, op => {
						op.args[1] = op.args[1] === 'asc' ? 'desc' : 'asc';
					});
				}

				// Get partial item from cursor
				const item = deserializeCursor(orderByOps, cursor);

				if (item) {
					addWhereStmts(
						this.modelClass(),
						this,
						orderByOps.map(({col, prop, dir}) => ({
							col,
							prop,
							// If going backward: asc => desc, desc => asc
							dir: before === (dir === 'asc') ? 'desc' : 'asc',
							val: get(item, prop, null)
						})),
						[],
						this.context()
					);
				}

				return this
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

						const setIfEnabled = (opt, val) => {
							res.pageInfo[opt] = info[opt] ? val : res.pageInfo[opt];
						}

						return Promise.resolve()
							.then(() => {
								if (info.total || info.hasNext || info.hasPrevious) {
									return origBuilder.resultSize().then(rs => {
										total = parseInt(rs, 10);
										setIfEnabled('total', total);
									});
								}
							})
							.then(() => {
								if (info.remaining || info.hasNext || info.hasPrevious) {
									return this.clone().resultSize().then(rs => {
										rs = parseInt(rs, 10);
										const remaining = rs - models.length;
										setIfEnabled('remaining', remaining);
										setIfEnabled('hasNext', (!before && remaining > 0) || (before && total - rs > 0));
										setIfEnabled('hasPrevious', (before && remaining > 0) || (!before && total - rs > 0));
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
