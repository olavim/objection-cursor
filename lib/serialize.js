const base64url = require('base64url');
const {set, get} = require('lodash');

function serializeCursor(ops, item) {
	const arr = item ? ops.map(({prop}) => {
		const val = get(item, prop, null);
		if (typeof val === 'undefined') {
			throw new Error(`Item is missing required property: '${prop}'`);
		}
		return base64url(JSON.stringify(val));
	}) : [];
	return arr.join('.');
}

function deserializeCursor(ops, cursor = '') {
	const vals = cursor.split('.').map(str => str && JSON.parse(base64url.decode(str)));
	return cursor ?
		ops.reduce((acc, {prop}, i) => {
			set(acc, prop, vals[i]);
			return acc;
		}, {}) :
		null;
}

module.exports = {serializeCursor, deserializeCursor};
