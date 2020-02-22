const CTX_OPERATIONS = '__cursor_operations';

function addOperation(builder, operation, args) {
	if (!operation.onAdd(builder, args)) {
		return builder;
	}

	const ops = builder.context()[CTX_OPERATIONS] || [];
	builder.mergeContext({[CTX_OPERATIONS]: [...ops, operation]});

	if (ops.length > 0) {
		return builder;
	}

	return builder
		.runBefore((result, builder) => {
			const ops = getOperations(builder);
			result = ops.reduce((res, op) => op.onBefore(builder, res), result);
			ops.forEach(op => op.addNativeOperation(builder));
			return result;
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
	return builder.mergeContext({[CTX_OPERATIONS]: ops});
}

function hasOperation(builder, selector) {
	return getOperations(builder, selector).length > 0;
}

function cloneOperations(builder) {
	return getOperations(builder).map(op => op.clone());
}

function setOperations(builder, operations) {
	return builder.mergeContext({[CTX_OPERATIONS]: operations});
}

function predicateForOperationSelector(selector) {
	if (selector instanceof RegExp) {
		return op => selector.test(op.name);
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
