/**
 * Mimics Objection's operation system, which is unfortunately private (https://github.com/Vincit/objection.js/issues/1697).
 *
 * The idea is to encapsulate each operation's life cycle in a class instead of handling them inside
 * runBefore, onBuild and runAfter methods. This makes it easier to prevent the query builder class
 * from becoming a bloated monolith.
 */
class Operation {
	constructor(name = null) {
		this.name = name;
		this.args = [];
	}

	onAdd(_builder, args) {
		this.args = args;
		return true;
	}

	onBefore(_builder, results) {
		return results;
	}

	onBuild() {}

	onAfter(_builder, results) {
		return results;
	}

	clone() {
		const op = new this.constructor(this.name);
		op.args = this.args.slice();
		return op;
	}
}

module.exports = Operation;
