const base64url = require('base64url');

function serializeCursor(ops, item) {
	const arr = item ? ops.map(({prop}) => base64url(JSON.stringify(item[prop]))) : [];
	return arr.join('.');
}

function deserializeCursor(ops, cursor = '') {
	const vals = cursor.split('.').map(str => str && JSON.parse(base64url.decode(str)));
	return cursor ? ops.reduce((acc, {prop}, i) => Object.assign(acc, {[prop]: vals[i]}), {}) : null;
}

module.exports = {serializeCursor, deserializeCursor};
