const base64url = require('base64url');
const {set, get} = require('lodash');
const {serializeValue, deserializeString} = require('./type-serializer');

function serializeCursor(ops, item) {
	if (!item) {
		return '';
	}

	return ops
		.map(({property}) => {
			const val = get(item, property, null);
			return base64url(serializeValue(val));
		})
		.join('.');
}

function deserializeCursor(ops, cursor = '') {
	if (!cursor) {
		return null;
	}

	const vals = cursor
		.split('.')
		.map(b64 => b64 ? deserializeString(base64url.decode(b64)) : b64);

	return ops.reduce((acc, {property}, i) => {
		set(acc, property, vals[i]);
		return acc;
	}, {});
}

module.exports = {serializeCursor, deserializeCursor};
