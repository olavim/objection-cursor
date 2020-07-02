const Operation = require('./Operation');

const CTX_OPERATIONS = '__cursor_operations';

function mergeContext(builder, nextContext) {
	if (typeof builder.clearContext === 'undefined') {
		// objection v1 (before this commit:
		// https://github.com/Vincit/objection.js/commit/9c9b25569e99ac3fd26d58791a7720d6d608c074 )
		return builder.mergeContext(nextContext);
	} else {
		return builder.context(nextContext);
	}
}

function addOperation(builder, operation, args = []) {
	if (!operation.onAdd(builder, args)) {
		return builder;
	}

	const ops = builder.context()[CTX_OPERATIONS] || [];
	mergeContext(builder, {[CTX_OPERATIONS]: [...ops, operation]});

	if (ops.length > 0) {
		return builder;
	}

	return builder
		.runBefore((result, builder) => {
			return getOperations(builder).reduce((res, op) => op.onBefore(builder, res), result);
		})
		.onBuild(builder => {
			getOperations(builder).forEach(op => op.onBuild(builder));
		})
		.runAfter((result, builder) => {
			return getOperations(builder).reduce((res, op) => op.onAfter(builder, res), result);
		});
}

function getOperations(builder, selector = true, match = true) {
	const ops = builder.context()[CTX_OPERATIONS] || [];
	const predicate = predicateForOperationSelector(selector);
	return ops.filter(op => predicate(op) === match);
}

function clearOperations(builder, selector) {
	const ops = getOperations(builder, selector, false);
	return mergeContext(builder, {[CTX_OPERATIONS]: ops});
}

function hasOperation(builder, selector) {
	return getOperations(builder, selector).length > 0;
}

function cloneOperations(builder) {
	return getOperations(builder).map(op => op.clone());
}

function setOperations(builder, operations) {
	return mergeContext(builder, {[CTX_OPERATIONS]: operations});
}

function predicateForOperationSelector(selector) {
	if (selector instanceof RegExp) {
		return op => selector.test(op.name);
	}

	if (selector && selector.prototype instanceof Operation) {
		return op => op instanceof selector;
	}

	if (typeof selector === 'string') {
		return op => op.name === selector;
	}

	if (typeof selector === 'boolean') {
		return () => selector;
	}

	return () => false;
}

module.exports = {
	addOperation,
	getOperations,
	setOperations,
	clearOperations,
	cloneOperations,
	hasOperation
};
