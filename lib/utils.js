const {get} = require('lodash');

function resolveOrderByOperation(explicitObj = {}, {column, property}, item) {
	let value = get(item, property, null);

	if (explicitObj[property]) {
		column = explicitObj[property].column;
		value = explicitObj[property].getValue(value);
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