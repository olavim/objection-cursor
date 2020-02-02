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

function getCoalescedOp(builder, coalesceObj = {}, {col, prop, dir}, item) {
	let val = get(item, prop, null);

	if (coalesceObj[prop]) {
		const model = builder.modelClass();
		const mappedCoalesce = coalesceObj[prop].map(v => stringifyObjectionBuilder(builder, v));
		const coalesceBindingsStr = mappedCoalesce.map(() => '?');
		col = stringifyObjectionBuilder(builder, col);
		val = stringifyObjectionBuilder(builder, val);
		col = model.raw(`COALESCE(??, ${coalesceBindingsStr})`, [col].concat(mappedCoalesce));
		val = model.raw(`COALESCE(?, ${coalesceBindingsStr})`, [val].concat(mappedCoalesce));
	}

	return {col, prop, val, dir};
}

/* Runs only if `flag` is falsy in `builder`'s context. Sets `flag` in `builder`'s context to
 * true, then to false after `fn` returns.
 */
function lockStatement(builder, flag, fn) {
	if (builder.context()[flag]) {
		return builder;
	}

	builder.mergeContext({[flag]: true});
	fn();
	builder.mergeContext({[flag]: false});
}

module.exports = {stringifyObjectionBuilder, getCoalescedOp, lockStatement};