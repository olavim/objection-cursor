const {castArray} = require('lodash');
const {lockStatement, stringifyObjectionBuilder} = require('../utils');
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

		orderByCoalesce(column, order = 'asc', coalesceValues = ['']) {
			return this
				.$data('orderByCoalesce', Object.assign({}, this.$data('orderByCoalesce'), {
					[columnToProperty(this.modelClass(), column)]: castArray(coalesceValues)
				}))
				.orderBy(column, order);
		}

		_buildOrderBy(builder) {
			lockStatement(builder, 'runBefore', () => {
				const model = this.modelClass();
				const orderByData = builder.$data('orderBy') || [];
				const orderByCoalesceData = builder.$data('orderByCoalesce') || {};

				for (let {column, order} of orderByData) {
					const coalesceValues = orderByCoalesceData[columnToProperty(model, column)];

					if (coalesceValues) {
						const mappedCoalesce = coalesceValues.map(val => stringifyObjectionBuilder(builder, val));
						const colStr = stringifyObjectionBuilder(builder, column);

						const coalesceBindingsStr = coalesceValues.map(() => '?').join(', ');

						builder.orderBy(
							model.raw(`COALESCE(??, ${coalesceBindingsStr})`, [colStr].concat(mappedCoalesce)),
							order
						);
					} else {
						builder.orderBy(column, order);
					}
				}
			});
		}
	}
}
