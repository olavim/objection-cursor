const base64url = require('base64url');

function serializeCursor(ops, item) {
	const arr = item ? ops.map(({col}) => base64url(JSON.stringify(item[col]))) : [];
	return arr.join('.');
}

function deserializeCursor(ops, cursor = '') {
	const vals = cursor.split('.').map(str => str && JSON.parse(base64url.decode(str)));
	return cursor ? ops.reduce((acc, {col}, i) => Object.assign(acc, {[col]: vals[i]}), {}) : null;
}

module.exports = {serializeCursor, deserializeCursor};
