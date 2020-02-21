const {raw, QueryBuilderOperation} = require('objection');
const {columnToProperty} = require('../../convert');

class OrderByExplicitOperation extends QueryBuilderOperation {
	constructor(name, opt) {
		super(name, opt);
		this.args = [];
	}

	onAdd(builder, args) {
		const ret = super.onAdd(builder, args);
		let [column, order = 'asc', compareValue, property] = args;

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

		this.args = [column, order, compareValue, property];
		return ret;
	}

	onBuildKnex(knexBuilder, builder) {
		const column = this.args[0].toKnexRaw
			? convertToKnexRaw(this.args[0], builder)
			: this.args[0];

		return knexBuilder.orderBy(column, this.args[1]);
	}

	clone() {
		const clone = super.clone();
		clone.args = this.args;
		return clone;
	}
}

function convertToKnexRaw(item, builder) {
	try {
		return item.toKnexRaw(builder);
	} catch (_err) {
		return item.toKnexRaw(builder.knex()); // v0
	}
}

module.exports = OrderByExplicitOperation;
