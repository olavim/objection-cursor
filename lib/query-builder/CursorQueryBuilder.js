const {castArray} = require('lodash');
const {raw} = require('objection');
const {
	addOperation,
	setOperations,
	clearOperations,
	cloneOperations,
	hasOperation
} = require('../operations/utils');
const OrderByOperation = require('../operations/OrderByOperation');
const OrderByExplicitOperation = require('../operations/OrderByExplicitOperation');
const CursorPageOperation = require('../operations/CursorPageOperation');

module.exports = function (options, Base) {
	return class extends Base {
		cursorPage(cursor, before) {
			return addOperation(this, new CursorPageOperation(options), [cursor, before]);
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

		orderByExplicit(...args) {
			return addOperation(this, new OrderByExplicitOperation(), args);
		}

		orderBy(column, order, native = false) {
			if (native) {
				return super.orderBy(column, order, native);
			}

			return addOperation(this, new OrderByOperation(), [column, order]);
		}

		clear(selector) {
			super.clear(selector);
			return clearOperations(this, selector);
		}

		has(selector) {
			return super.has(selector) || hasOperation(this, selector);
		}

		clone() {
			const clone = super.clone();
			setOperations(clone, cloneOperations(this));
			return clone;
		}
	};
};
