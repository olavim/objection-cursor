const Operation = require('./Operation');

class OrderByOperation extends Operation {
	constructor() {
		super('orderBy')
	}

	onAdd(builder, args) {
		args[1] = (args[1] || 'asc').toLowerCase();
		return super.onAdd(builder, args);
	}

	addNativeOperation(builder) {
		parent(builder).orderBy.call(builder, this.column, this.order);
	}

	get column() {
		return this.args[0];
	}

	get order() {
		return this.args[1];
	}
}

function parent(cls) {
	const instanceProto = Object.getPrototypeOf(cls);
	return Object.getPrototypeOf(instanceProto);
}

module.exports = OrderByOperation;
