const {serializeCursor, deserializeCursor} = require('./lib/serialize');
const {get} = require('lodash');

function addWhereComposites(builder, composites) {
	for (const {col, val} of composites) {
		const op = val === null ? 'is' : '=';
		builder.andWhere(col, op, val);
	}
}

function addWhereStmts(builder, ops, composites = []) {
	if (ops.length === 0) {
		return builder.where(false);
	}

	const op = ops[0].val === null ? 'is not' : ops[0].dir === 'asc' ? '>' : '<';

	if (ops.length === 1) {
		return builder.where(ops[0].col, op, ops[0].val);
	}

	composites = [ops[0], ...composites];

	builder.andWhere(function () {
		this.where(ops[0].col, op, ops[0].val);
		this.orWhere(function () {
			addWhereComposites(this, composites);
			this.andWhere(function () {
				// Add where statements recursively
				addWhereStmts(this, ops.slice(1), composites);
			});
		});
	})
}

function columnToProperty(model, col) {
	if (typeof col === 'string') {
		const prop = col.substr(col.lastIndexOf('.') + 1);
		return model.columnNameToPropertyName(prop);
	}

	const {columnName, access} = col.reference;
	return `${model.columnNameToPropertyName(columnName)}.${access.map(a => a.ref).join('.')}`;
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

				const orderBy = this.context().orderBy || [];
				orderBy.push({col, dir});

				return this.mergeContext({orderBy});
			}

			cursorPage(cursor, before = false) {
				const origBuilder = this.clone();

				if (!this.has(/limit/)) {
					this.limit(options.limit);
				}

				const orderByOps = this.context().orderBy.map(({col, dir}) => ({
					col,
					prop: columnToProperty(this.modelClass(), col),
					dir: (dir || 'asc').toLowerCase()
				}));

				if (before) {
					this.clear(/orderBy/);
					this.mergeContext({orderBy: []});
					for (const {col, dir} of orderByOps) {
						this.orderBy(col, dir === 'asc' ? 'desc' : 'asc');
					}
				}

				// Get partial item from cursor
				const item = deserializeCursor(orderByOps, cursor);

				if (item) {
					addWhereStmts(this, orderByOps.map(({col, prop, dir}) => ({
						col,
						// If going backward: asc => desc, desc => asc
						dir: before === (dir === 'asc') ? 'desc' : 'asc',
						val: get(item, prop)
					})));
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
