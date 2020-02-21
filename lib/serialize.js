const base64url = require('base64url');
const {set, get} = require('lodash');
const {serializeValue, deserializeString} = require('./type-serializer');

function serializeCursor(keys, item) {
	if (!item) {
		return '';
	}

	return keys
		.map(key => {
			const val = get(item, key, null);
			return base64url(serializeValue(val));
		})
		.join('.');
}

function deserializeCursor(keys, cursor = '') {
	if (!cursor) {
		return null;
	}

	const vals = cursor
		.split('.')
		.map(b64 => b64 ? deserializeString(base64url.decode(b64)) : b64);

	return keys.reduce((acc, key, i) => {
		set(acc, key, vals[i]);
		return acc;
	}, {});
}

module.exports = {serializeCursor, deserializeCursor};
