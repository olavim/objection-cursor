const {castArray} = require('lodash');
const {raw} = require('objection');
const OrderByExplicitOperation = require('./operations/OrderByExplicitOperation');
const CursorPageOperation = require('./operations/CursorPageOperation');

module.exports = function (options, Base) {
	return class extends Base.QueryBuilder {
		cursorPage(cursor, before) {
			return this.addOperation(new CursorPageOperation('cursorPage', options), [cursor, before]);
		}

		nextCursorPage(cursor) {
			return this.cursorPage(cursor, false);
		}

		previousCursorPage(cursor) {
			return this.cursorPage(cursor, true);
		}

		// DEPRECATED: replaced by `orderByExplicit`
		orderByCoalesce(column, order, coalesceValues = ['']) {
			coalesceValues = castArray(coalesceValues);
			const coalesceBindingsStr = coalesceValues.map(() => '?').join(', ');

			return this.orderByExplicit(
				raw(`COALESCE(??, ${coalesceBindingsStr})`, [column].concat(coalesceValues)),
				order
			);
		}

		orderByExplicit(column, order, compareValue, property) {
			const args = [column, order, compareValue, property];
			return this.addOperation(new OrderByExplicitOperation('orderByExplicit'), args);
		}
	}
}
