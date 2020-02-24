const {get, castArray} = require('lodash');
const {getOperations, clearOperations} = require('./utils');
const Operation = require('./Operation');
const OrderByOperation = require('./OrderByOperation');
const {serializeCursor, deserializeCursor} = require('../serialize');
const {columnToProperty} = require('../convert');

class CursorPageOperation extends Operation {
	constructor(options) {
		super('cursorPage');
		this.options = options;
		this.originalBuilder = null;
		this.resultSizeBuilder = null;
		this.keysetProperties = [];
	}

	onAdd(builder, args) {
		if (getOperations(builder, CursorPageOperation).length > 0) {
			return false;
		}

		const [cursor = null, before = false] = args;
		return super.onAdd(builder, [cursor, before]);
	}

	onBefore(builder, result) {
		const orderByOps = getOperations(builder, OrderByOperation);

		// Swap orderBy directions when going backward
		if (this.before) {
			for (const op of orderByOps) {
				op.args[1] = op.order === 'asc' ? 'desc' : 'asc';
			}
		}

		this.keysetProperties = orderByOps.map(op => ({
			column: op.column,
			order: op.order,
			compareValue: op.args[2] || (val => val),
			property: op.args[3] || columnToProperty(builder.modelClass(), op.column)
		}));

		// Save copies of current builder for pageInfo
		this.originalBuilder = clearOperations(builder.clone(), CursorPageOperation);
		this.resultSizeBuilder = this.originalBuilder.clone();

		return result;
	}

	onBuild(builder) {
		addWhereStatements(builder, this.keysetProperties, this.keyset);
		addWhereStatements(this.resultSizeBuilder, this.keysetProperties, this.keyset);

		// Add default limit unless we are in the process of calculating total rows
		if (!builder.has(/limit/)) {
			builder.limit(this.options.limit);
		}
	}

	onAfter(_builder, result) {
		// We want to always return results in the same order, as if turning pages in a book
		if (this.before) {
			result.reverse();
		}

		/* When we reach end while going forward, save the last element of the last page, but discard
		* first element of last page. If we try to go forward, we get an empty result, because
		* there are no elements after the last one. If we go back from there, we get results for
		* the last page. The opposite is true when going backward from the first page.
		*/
		const first = result.length > 0 ? result[0] : (this.before ? this.keyset : null);
		const last = result.length > 0 ? result[result.length - 1] : (this.before ? null : this.keyset);

		return this._getAdditionalPageInfo(result)
			.then(additionalPageInfo => ({
				results: result,
				pageInfo: Object.assign(additionalPageInfo, {
					next: serializeCursor(this.keysetKeys, last),
					previous: serializeCursor(this.keysetKeys, first)
				})
			}));
	}

	get keysetKeys() {
		return this.keysetProperties.map(op => op.property);
	}

	/**
	 * When building the cursor, we want to know the values of the properties that the user has
	 * ordered their data by. We build a keyset based on those columns to make it easier to visualize
	 * for the developer. For example, if the queried data was something like {id: 2, title: 'hi', author: 'you'},
	 * and the user ordered their data by `id` and `author`, then the keyset would be {id: 2, author: 'you'}.
	 */
	get keyset() {
		return deserializeCursor(this.keysetKeys, this.cursor);
	}

	get cursor() {
		return this.args[0];
	}

	get before() {
		return this.args[1] || false;
	}

	clone() {
		const op = super.clone();
		op.options = Object.assign({}, this.options);
		op.originalBuilder = this.originalBuilder && this.originalBuilder.clone();
		op.resultSizeBuilder = this.resultSizeBuilder && this.resultSizeBuilder.clone();
		op.keysetProperties = this.keysetProperties.slice();
		return op;
	}

	_getAdditionalPageInfo(result) {
		const pageInfo = {};

		// Check if at least one given option is enabled
		const isEnabled = opts => castArray(opts).some(key => this.options.pageInfo[key]);
		const setIfEnabled = (key, val) => {
			pageInfo[key] = this.options.pageInfo[key] ? val : undefined;
		}

		let total;

		return Promise.resolve()
			.then(() => {
				if (isEnabled(['total', 'hasNext', 'hasPrevious', 'remainingBefore', 'remainingAfter'])) {
					// Count number of rows without where statements or limits
					return this.originalBuilder.resultSize().then(rs => {
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
					return this.resultSizeBuilder.resultSize().then(rs => {
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
function addWhereStatements(builder, keysetProperties, keyset, composites = []) {
	if (!keyset) {
		return;
	}

	composites = [keysetProperties[0], ...composites];
	const comp = keysetProperties[0].order === 'asc' ? '>' : '<';

	builder.andWhere(function () {
		this.where(keysetProperties[0].column, comp, getValueToCompare(keysetProperties[0], keyset));

		if (keysetProperties.length > 1) {
			this.orWhere(function () {
				for (const composite of composites) {
					this.andWhere(composite.column, getValueToCompare(composite, keyset));
				}

				this.andWhere(function () {
					// Add where statements recursively
					addWhereStatements(this, keysetProperties.slice(1), keyset, composites);
				});
			});
		}
	});
}

function getValueToCompare({property, compareValue}, keyset) {
	const value = get(keyset, property, null);
	return compareValue ? compareValue(value) : value;
}

module.exports = CursorPageOperation;
