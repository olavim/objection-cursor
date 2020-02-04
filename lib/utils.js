const {get} = require('lodash');

function stringifyObjectionBuilder(builder, val) {
	if (val && typeof val.toKnexRaw === 'function') {
		// Stringify raw- and reference builders, since `Model.raw` doesn't do it
		try {
			return val.toKnexRaw(builder); // Objection v1
		} catch (_err) {
			return val.toKnexRaw(builder.knex()); // Objection v0
		}
	}

	return val;
}

function getCoalescedOp(builder, coalesceObj = {}, {column, property, order}, item) {
	let value = get(item, property, null);

	if (coalesceObj[property]) {
		const model = builder.modelClass();
		const mappedCoalesce = coalesceObj[property].map(v => stringifyObjectionBuilder(builder, v));
		const coalesceBindingsStr = mappedCoalesce.map(() => '?');
		column = stringifyObjectionBuilder(builder, column);
		value = stringifyObjectionBuilder(builder, value);
		column = model.raw(`COALESCE(??, ${coalesceBindingsStr})`, [column].concat(mappedCoalesce));
		value = model.raw(`COALESCE(?, ${coalesceBindingsStr})`, [value].concat(mappedCoalesce));
	}

	return {column, property, value, order};
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

module.exports = {stringifyObjectionBuilder, getCoalescedOp, lockStatement};