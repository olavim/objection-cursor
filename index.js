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

module.exports = Base => {
	class CursorQueryBuilder extends Base.QueryBuilder {
		cursorPage(cursor, reverse = false) {
			const origBuilder = this.clone();

			const orderByOps = [];
			this._operations
				.filter(op => op.name === 'orderBy')
				.forEach(({args: [col, dir]}) => {
					orderByOps.push({col, dir: (dir || 'asc').toLowerCase()});
				});

			if (reverse) {
				this.clear('orderBy');
				for (const {col, dir} of orderByOps) {
					this.orderBy(col, dir === 'asc' ? 'desc' : 'asc');
				}
			}

			let first;
			let last;

			// Add where statements if a cursor is given
			if (cursor) {
				// Get partial first and last element from cursor
				({first, last} = deserializeCursor(orderByOps, cursor));

				// Do not add where statements in some cases so that we may go back after end of results
				if ((reverse && first) || (!reverse && last)) {
					addWhereStmts(this, orderByOps.map(({col, dir}) => ({
						col,
						// If reverse: asc  => desc, desc => asc
						dir: reverse === (dir === 'asc') ? 'desc' : 'asc',
						val: (reverse ? first : last)[col]
					})));
				}
			}

			return this
				.runAfter((models, builder) => {
					// We want to always return results in the same order; as if turning pages in a book
					if (reverse) {
						models.reverse();
					}

					/* When we reach end while going forward, save the last element of the last page, but discard
					 * first element of last page. If we try to go forward, we get an empty result, because
					 * there are no elements after the last one. If we go back from there, we get results for
					 * the last page. The opposite is true when going backward from the first page.
					 */
					const newFirst = models.length > 0 ? models[0] : (reverse ? first : null);
					const newLast = models.length > 0 ? models[models.length - 1] : (reverse ? null : last);

					// Build new cursor
					const cursor = serializeCursor(orderByOps, newFirst, newLast);

					return origBuilder
						.resultSize()
						.then(total => ({
							results: models,
							pageInfo: {cursor, total}
						}));
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
};
