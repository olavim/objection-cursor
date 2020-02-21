const {QueryBuilderOperation} = require('objection');
const {get, castArray} = require('lodash');
const {serializeCursor, deserializeCursor} = require('../../serialize');
const {columnToProperty} = require('../../convert');

const ORIGINAL_BUILDER = '__cursorPage_originalBuilder';
const RESULTSIZE_BUILDER = '__cursorPage_resultSizeBuilder';

class CursorPageOperation extends QueryBuilderOperation {
	constructor(name, options, opt) {
		super(name, opt);
		this.options = options;
		this.cursor = null;
		this.before = false;
		this.originalBuilder = null;
		this.resultSizeBuilder = null;
		this.keysetProperties = [];
	}

	onAdd(_builder, args) {
		const [cursor = null, before = false] = args;
		this.cursor = cursor;
		this.before = before;
		return true;
	}

	onBefore3(builder, result) {
		this.originalBuilder = builder.clone().mergeContext({[ORIGINAL_BUILDER]: true});

		builder.forEachOperation(/orderBy/, op => {
			const order = op.args[1] || 'asc';

			this.keysetProperties.push({
				column: op.args[0],
				order: this.before === (order.toLowerCase() === 'asc') ? 'desc' : 'asc',
				compareValue: op.args[2] || (val => val),
				property: op.args[3] || columnToProperty(builder.modelClass(), op.args[0])
			});
		});

		return result;
	}

	onBuild(builder) {
		if (builder.context()[ORIGINAL_BUILDER]) {
			return;
		}

		addWhereStatements(builder, this.keysetProperties, this.keyset());

		// Add default limit unless we are in the process of calculating total rows
		if (!builder.has(/limit/) && !builder.context()[RESULTSIZE_BUILDER]) {
			builder.limit(this.options.limit);
		}

		// Swap orderBy directions when going backward
		if (this.before) {
			builder.forEachOperation(/orderBy/, op => {
				const [column, order, ...args] = op.args;
				op.args = [column, order === 'asc' ? 'desc' : 'asc', ...args];
			});
		}

		// Save copy of current builder for pageInfo (hasNext, remaining, etc.)
		this.resultSizeBuilder = builder.clone().mergeContext({[RESULTSIZE_BUILDER]: true});
	}

	onAfter3(_builder, result) {
		// We want to always return results in the same order, as if turning pages in a book
		if (this.before) {
			result.reverse();
		}

		/* When we reach end while going forward, save the last element of the last page, but discard
		* first element of last page. If we try to go forward, we get an empty result, because
		* there are no elements after the last one. If we go back from there, we get results for
		* the last page. The opposite is true when going backward from the first page.
		*/
		const first = result.length > 0 ? result[0] : (this.before ? this.keyset() : null);
		const last = result.length > 0 ? result[result.length - 1] : (this.before ? null : this.keyset());

		return this._getAdditionalPageInfo(result)
			.then(additionalPageInfo => ({
				results: result,
				pageInfo: Object.assign(additionalPageInfo, {
					next: serializeCursor(this.keysetKeys(), last),
					previous: serializeCursor(this.keysetKeys(), first)
				})
			}));
	}

	clone() {
		const clone = super.clone();

		clone.options = this.options;
		clone.cursor = this.cursor;
		clone.before = this.before;
		clone.originalBuilder = this.originalBuilder;
		clone.resultSizeBuilder = this.resultSizeBuilder;
		clone.keysetProperties = this.keysetProperties;

		return clone;
	}

	keysetKeys() {
		return this.keysetProperties.map(op => op.property);
	}

	/**
	 * When building the cursor, we want to know the values of the properties that the user has
	 * ordered their data by. We build a keyset based on those columns to make it easier to visualize
	 * for the developer. For example, if the queried data was something like {id: 2, title: 'hi', author: 'you'},
	 * and the user ordered their data by `id` and `author`, then the keyset would be {id: 2, author: 'you'}.
	 */
	keyset() {
		return deserializeCursor(this.keysetKeys(), this.cursor);
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
 * Comparisons are simply flipped if order is 'desc', and Objection knows to compare columns to
 * nulls correctly with "column IS NULL" instead of "column = NULL".
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
