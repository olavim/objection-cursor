const base64url = require('base64url');
const {serializeValue, deserializeString} = require('./type-serializer');

function serializeCursor(values) {
	if (!values) {
		return '';
	}

	return values
		.map(value => base64url(serializeValue(value)))
		.join('.');
}

function deserializeCursor(cursor = '') {
	if (!cursor) {
		return [];
	}

	return cursor
		.split('.')
		.map(b64 => b64 ? deserializeString(base64url.decode(b64)) : b64);
}

module.exports = {serializeCursor, deserializeCursor};
