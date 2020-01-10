import {get} from 'lodash';
import {ColumnRef, QueryBuilder} from 'objection';
import {WhereStmtOp} from '../query-builder';

export function stringifyObjectionBuilder<Q extends QueryBuilder<any, any>>(builder: Q, val: any) {
	if (val && typeof val.toKnexRaw === 'function') {
		// Stringify raw- and reference builders, since `Model.raw` doesn't do it
		try {
			return val.toKnexRaw(builder); // Objection v1
		} catch (_err) {
			return val.toKnexRaw((builder as any).knex()); // Objection v0
		}
	}

	return val;
}

export function getCoalescedOp<Q extends QueryBuilder<any, any>>(
	builder: Q,
	coalesceObj: {[k: string]: ColumnRef[]} = {},
	op: WhereStmtOp,
	item: any
) {
	const {prop, dir} = op;
	let {col} = op;
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
export function lockStatement<Q extends QueryBuilder<any, any>>(builder: Q, flag: string, fn: (...args: any[]) => any) {
	if (builder.context()[flag]) {
		return;
	}

	builder.mergeContext({[flag]: true});
	fn();
	builder.mergeContext({[flag]: false});
}
