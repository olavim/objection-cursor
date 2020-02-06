const {castArray} = require('lodash');
const {raw} = require('objection');
const {lockStatement} = require('../utils');
const {columnToProperty} = require('../convert');
const ContextBase = require('./ContextBase');

module.exports = function (Base) {
	return class extends ContextBase(Base) {
		orderBy(column, order = 'asc') {
			if (this.$flag('runBefore')) {
				// orderBy was called from an onBuild handler
				return super.orderBy(column, order);
			}

			this.$data('orderBy', (this.$data('orderBy') || []).concat([{column, order}]));

			return this
				.runBefore((result, builder) => {
					this._buildOrderBy(builder);
					return result;
				});
		}

		orderByCoalesce(column, order, coalesceValues = ['']) {
			coalesceValues = castArray(coalesceValues);
			const coalesceBindingsStr = coalesceValues.map(() => '?').join(', ');

			return this.orderByExplicit({
				column: raw(`COALESCE(??, ${coalesceBindingsStr})`, [column].concat(coalesceValues)),
				order,
				property: columnToProperty(this.modelClass(), column),
				getValue: val => raw(`COALESCE(?, ${coalesceBindingsStr})`, [val].concat(coalesceValues))
			});
		}

		orderByExplicit({column, order, property, getValue = val => val}) {
			return this
				.$data('orderByExplicit', Object.assign({}, this.$data('orderByExplicit'), {
					[property]: {column, getValue}
				}))
				.orderBy(property, order);
		}

		_buildOrderBy(builder) {
			lockStatement(builder, 'runBefore', () => {
				builder.clear(/orderBy/);

				const orderByData = builder.$data('orderBy') || [];
				const orderByExplicitData = builder.$data('orderByExplicit') || {};

				for (const {column: property, order} of orderByData) {
					const column = orderByExplicitData[property] ? orderByExplicitData[property].column : property;
					builder.orderBy(column, order);
				}
			});
		}
	}
}
