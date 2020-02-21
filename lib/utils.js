const {get} = require('lodash');

function resolveOrderByOperation({column, property, compareValue}, item) {
	let value = get(item, property, null);

	if (compareValue) {
		value = compareValue(value);
	}

	return {column, value};
}

/* Runs only if `flag` is falsy in `builder`'s context. Sets `flag` in `builder`'s context to
 * true, then to false after `fn` returns.
 */
function lockStatement(builder, flag, fn) {
	if (builder.$flag(flag)) {
		return builder;
	}

	builder.$flag(flag, true);
	fn();
	builder.$flag(flag, false);
}

module.exports = {resolveOrderByOperation, lockStatement};