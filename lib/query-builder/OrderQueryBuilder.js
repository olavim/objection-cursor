const {castArray} = require('lodash');
const {raw} = require('objection');
const {lockStatement} = require('../utils');
const {columnToProperty} = require('../convert');
const ContextBase = require('./ContextBase');

module.exports = function (Base) {
	return class extends ContextBase(Base) {
		orderBy(column, order = 'asc') {
			/* To build the cursor we first gather all the `orderBy` instructions in memory, and then only later
			 * tell Objection about these instructions. This lets us relax the need to chain operations in a
			 * specific order. We might need to "flip" the operations when getting a previous cursor page,
			 * for example, which is something we know only after the `cursorPage` method has been called.
			 */
			if (this.$flag('runBefore')) {
				// orderBy was called from an onBuild handler
				return super.orderBy(column, order);
			}

			/* We want to know how exactly these `orderBy`s were called, which is something Objection
			 * cannot tell us since we do modifications on the operations later.
			 */
			this.$data('orderBy', (this.$data('orderBy') || []).concat([{column, order}]));

			return this
				.runBefore((result, builder) => {
					this._buildOrderBy(builder);
					return result;
				});
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

		orderByExplicit(column, order, getValue, property) {
			// Convert `column` to RawBuilder if it isn't one
			if (!column.constructor || column.constructor.name !== 'RawBuilder') {
				return this.orderBy(column, order);
			}

			/* By default, get a RawBuilder for a value that is identical to the column RawBuilder,
			 * except first argument is the value instead of column name.
			 */
			if (!getValue) {
				// Change first ?? binding to ? (value instead of column)
				const sql = column._sql.replace('??', '?');
				getValue = val => raw(sql, [val].concat(column._args.slice(1)));
			}

			// By default, get column name from first argument of the column RawBuilder
			if (!property) {
				const columnName = column._args[0];
				property = columnToProperty(this.modelClass(), columnName);
			}

			return this
				.$data('orderByExplicit', Object.assign({}, this.$data('orderByExplicit'), {
					[property]: {column, getValue}
				}))
				.orderBy(property, order);
		}

		_buildOrderBy(builder) {
			lockStatement(builder, 'runBefore', () => {
				/* Clear any existing `orderBy` instructions (runBefore might be called multiple times)
				 * to prevent duplicates in the resulting query builder. This shouldn't affect the end result,
				 * but duplicates make debugging harder.
				 */
				builder.clear(/orderBy/);

				const orderByData = builder.$data('orderBy') || [];
				const orderByExplicitData = builder.$data('orderByExplicit') || {};

				// Tell Objection about any `orderBy` instructions
				for (const {column: property, order} of orderByData) {
					const column = orderByExplicitData[property] ? orderByExplicitData[property].column : property;
					builder.orderBy(column, order);
				}
			});
		}
	}
}
