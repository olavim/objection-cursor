const {get, castArray} = require('lodash');
const {getOperations, hasOperation, clearOperations} = require('./utils');
const Operation = require('./Operation');
const OrderByOperation = require('./OrderByOperation');
const {serializeCursor, deserializeCursor} = require('../serialize');
const {columnToProperty} = require('../convert');

class CursorPageOperation extends Operation {
	constructor(options) {
		super('cursorPage');
		this.options = options;
		this.originalBuilder = null;
	}

	onAdd(builder, args) {
		if (hasOperation(builder, CursorPageOperation)) {
			return false;
		}

		const [cursor = null, before = false] = args;
		return super.onAdd(builder, [cursor, before]);
	}

	onBefore(builder, result) {
		const orderByOps = getOperations(builder, OrderByOperation);

		if (this.args[0] && orderByOps.length !== this.keyset.length) {
			// Cursor was given, but keyset length does not match the number of orderBy operations
			throw new Error('Cursor does not match ordering');
		}

		if (this.before) {
			// Reverse order by operation directions
			for (const op of orderByOps) {
				op.args[1] = op.order === 'asc' ? 'desc' : 'asc';
			}
		}

		return result;
	}

	onBuild(builder) {
		// Save copy of builder without modifications made by this operation
		this.originalBuilder = clearOperations(builder.clone(), CursorPageOperation);

		whereMore(builder, this.keyset);

		// Add default limit
		if (!builder.has(/limit/)) {
			builder.limit(this.options.limit);
		}
	}

	onAfter(builder, data) {
		// We want to always return results in the same order, as if turning pages in a book
		if (this.before) {
			data.reverse();
		}

		// Get more results before the first result, or after the last result
		const firstResult = data[0];
		const lastResult = data[data.length - 1];

		// If we didn't get results, use the last known keyset as a fallback
		const fallbackPreviousKeyset = this.before ? this.keyset : null;
		const fallbackNextKeyset = this.before ? null : this.keyset;

		/* When we reach end while going forward, save the last element of the last page, but discard
		 * first element of last page. If we try to go forward, we get an empty result, because
		 * there are no elements after the last one. If we go back from there, we get results for
		 * the last page. The opposite is true when going backward from the first page.
		 */
		const previousKeyset = firstResult ? toKeyset(builder, firstResult) : fallbackPreviousKeyset;
		const nextKeyset = lastResult ? toKeyset(builder, lastResult) : fallbackNextKeyset;

		let results;
		let nodes;

		if (this.options.results) {
			results = data;
		}

		if (this.options.nodes) {
			nodes = data.map(data => ({
				data,
				cursor: serializeCursor(toKeyset(builder, data))
			}));
		}

		return this._getAdditionalPageInfo(data)
			.then(additionalPageInfo => ({
				results,
				nodes,
				pageInfo: Object.assign(additionalPageInfo, {
					next: serializeCursor(nextKeyset),
					previous: serializeCursor(previousKeyset)
				})
			}));
	}

	get keyset() {
		return deserializeCursor(this.args[0]);
	}

	get before() {
		return this.args[1] || false;
	}

	clone() {
		const op = super.clone();
		op.options = Object.assign({}, this.options);
		op.originalBuilder = this.originalBuilder && this.originalBuilder.clone();
		return op;
	}

	_getAdditionalPageInfo(result) {
		const pageInfo = {};

		// Check if at least one given option is enabled
		const isEnabled = opts => castArray(opts).some(key => this.options.pageInfo[key]);
		const setIfEnabled = (key, val) => {
			pageInfo[key] = this.options.pageInfo[key] ? val : undefined;
		};

		let total;

		return Promise.resolve()
			.then(() => {
				if (isEnabled(['total', 'hasNext', 'hasPrevious', 'remainingBefore', 'remainingAfter'])) {
					// Count number of rows without where statements or limits
					return this.originalBuilder.clone().resultSize().then(rs => {
						total = parseInt(rs, 10);
						setIfEnabled('total', total);
					});
				}
			})
			.then(() => {
				if (isEnabled(['hasMore', 'hasNext', 'hasPrevious', 'remaining', 'remainingBefore', 'remainingAfter'])) {
					const builder = this.originalBuilder.clone();
					whereMore(builder, this.keyset);

					/* Count number of rows without limits, but retain where statements to count rows
					 * only in one direction. I.e. get number of rows before/after current results.
					 */
					return builder.resultSize().then(rs => {
						const remaining = rs - result.length;
						setIfEnabled('remaining', remaining);
						setIfEnabled('remainingBefore', this.before ? remaining : total - rs);
						setIfEnabled('remainingAfter', this.before ? total - rs : remaining);
						setIfEnabled('hasMore', remaining > 0);
						setIfEnabled('hasPrevious', (this.before && remaining > 0) || (!this.before && total - rs > 0));
						setIfEnabled('hasNext', (!this.before && remaining > 0) || (this.before && total - rs > 0));
					});
				}
			})
			.then(() => pageInfo);
	}
}

/**
 * Returns array of object values, ordered by `orderBy` operations.
 */
function toKeyset(builder, obj) {
	const databaseJson = obj.$toDatabaseJson();

	return getOperations(builder, OrderByOperation).map(op => {
		const property = op.property || columnToProperty(builder.modelClass(), op.column);

		// `$toDatabaseJson` removes joined data, so we also check the original model
		return get(databaseJson, property, null) || get(obj, property, null);
	});
}

function whereMore(builder, keyset) {
	if (keyset.length > 0) {
		const comparisons = getOperations(builder, OrderByOperation).map((op, idx) => ({
			column: op.column,
			order: op.order,
			value: op.compareValue ? op.compareValue(keyset[idx]) : keyset[idx]
		}));

		_whereMore(builder, comparisons, []);
	}
}


/**
 * Recursive procedure to build where statements needed to get rows before/after some given row.
 *
 * Let's say we want to order by columns [c1, c2, c3], all in ascending order for simplicity.
 * The resulting structure looks like this:
 *
 * - If c1 > value, return row
 * - Otherwise, if c1 = value and c2 > value, return row
 * - Otherwise, if c1 = value and c2 = value and c3 > value, return row
 * - Otherwise, do not return row
 *
 * Comparisons are simply flipped if order is 'desc', and Objection (usually) knows to compare
 * columns to nulls correctly with "column IS NULL" instead of "column = NULL".
 */
function _whereMore(builder, comparisons, composites) {
	const comparison = comparisons[0];
	composites = [comparison, ...composites];
	const op = comparison.order === 'asc' ? '>' : '<';

	builder.andWhere(function () {
		this.where(comparison.column, op, comparison.value);

		if (comparisons.length > 1) {
			this.orWhere(function () {
				for (const composite of composites) {
					this.andWhere(composite.column, composite.value);
				}

				this.andWhere(function () {
					// Add where statements recursively
					_whereMore(this, comparisons.slice(1), composites);
				});
			});
		}
	});
}

module.exports = CursorPageOperation;
