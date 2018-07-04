const {serializeCursor, deserializeCursor} = require('./lib/serialize');

function addWhereStmts(builder, ops, composites = []) {
	if (ops.length === 0) {
		return builder.where(false);
	}

	if (ops.length === 1) {
		return builder.where(ops[0].col, ops[0].dir === 'asc' ? '>' : '<', ops[0].val);
	}

	const compCols = composites.map(c => c.col);
	const compVals = composites.map(c => c.val);

	builder
		.where(ops[0].col, ops[0].dir === 'asc' ? '>' : '<', ops[0].val)
		.orWhere(function () {
			this.whereComposite(
				[ops[0].col, ...compCols],
				[ops[0].val, ...compVals]
			);
			this.andWhere(function () {
				// Add where statements recursively
				addWhereStmts(this, ops.slice(1), [ops[0], ...composites]);
			});
		});
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
			cursorPage(cursor, before = false) {
				const origBuilder = this.clone();

				if (!this.has('limit')) {
					this.limit(options.limit);
				}

				const orderByOps = this._operations
					.filter(op => op.name === 'orderBy')
					.map(({args: [col, dir]}) => ({
						col,
						dir: (dir || 'asc').toLowerCase()
					}));

				if (before) {
					this.clear('orderBy');
					for (const {col, dir} of orderByOps) {
						this.orderBy(col, dir === 'asc' ? 'desc' : 'asc');
					}
				}

				// Get partial item from cursor
				const item = deserializeCursor(orderByOps, cursor);

				if (item) {
					addWhereStmts(this, orderByOps.map(({col, dir}) => ({
						col,
						// If going backward: asc => desc, desc => asc
						dir: before === (dir === 'asc') ? 'desc' : 'asc',
						val: item[col]
					})));
				}

				return this
					.runAfter((models, builder) => {
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
										total = rs;
										setIfEnabled('total', rs);
									});
								}
							})
							.then(() => {
								if (info.remaining || info.hasNext || info.hasPrevious) {
									return builder.clone().resultSize().then(rs => {
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
