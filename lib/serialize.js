const base64url = require('base64url');

function serializeCursor(ops, first, last) {
	const firstArr = [];
	const lastArr = [];

	for (const {col} of ops) {
		if (first) {
			firstArr.push(base64url(JSON.stringify(first[col])));
		}
		if (last) {
			lastArr.push(base64url(JSON.stringify(last[col])));
		}
	}

	return [firstArr.join('.'), lastArr.join('.')].join('~');
}

function deserializeCursor(ops, cursor = '') {
	const [firstStr = '', lastStr = ''] = cursor.split('~');
	const firstVals = firstStr.split('.').map(str => str && JSON.parse(base64url.decode(str)));
	const lastVals = lastStr.split('.').map(str => str && JSON.parse(base64url.decode(str)));

	return [
		firstStr ? ops.reduce((acc, {col}, i) => Object.assign(acc, {[col]: firstVals[i]}), {}) : null,
		lastStr ? ops.reduce((acc, {col}, i) => Object.assign(acc, {[col]: lastVals[i]}), {}) : null
	];
}

module.exports = {serializeCursor, deserializeCursor};
