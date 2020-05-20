const {raw} = require('objection');
const OrderByOperation = require('./OrderByOperation');
const {columnToProperty} = require('../convert');

class OrderByExplicitOperation extends OrderByOperation {
	onAdd(builder, args) {
		let [column, order, compareValue, property] = args;

		// Convert `column` to RawBuilder if it isn't one
		if (typeof column === 'string' || column.constructor.name !== 'RawBuilder') {
			column = raw('??', column);
		}

		if (typeof compareValue === 'string') {
			property = compareValue;
			compareValue = null;
		}

		/* By default `compareValue` is a function that returns a RawBuilder that is identical to the
		 * column RawBuilder, except first argument is the given value instead of column name.
		 */
		if (!compareValue) {
			// Change first ?? binding to ? (value instead of column)
			const sql = column._sql.replace('??', '?');
			compareValue = val => raw(sql, [val].concat(column._args.slice(1)));
		}

		// By default, get column name from first argument of the column RawBuilder
		if (!property) {
			property = columnToProperty(builder.modelClass(), column._args[0]);
		}

		return super.onAdd(builder, [column, order, compareValue, property]);
	}

	get compareValue() {
		return this.args[2];
	}

	get property() {
		return this.args[3];
	}
}

module.exports = OrderByExplicitOperation;
