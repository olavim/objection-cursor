const Operation = require('./Operation');

class OrderByOperation extends Operation {
	constructor() {
		super('orderBy');
	}

	onAdd(builder, args) {
		args[1] = (args[1] || 'asc').toLowerCase();
		return super.onAdd(builder, args);
	}

	onBuild(builder) {
		builder.orderBy(this.column, this.order, this.nulls, true);
	}

	get column() {
		return this.args[0];
	}

	get order() {
		return this.args[1];
	}

	get nulls() {
		return this.args[2];
	}
}

module.exports = OrderByOperation;
