const base64url = require('base64url');
const {set, get} = require('lodash');

const typeHandlers = [
	{
		name: 'date',
		test: value => value instanceof Date,
		deserialize: value => new Date(value)
	}
]

const handlerPrefix = h => h ? `#__cur_t:${h.name}#` : '';

function serializeCursor(ops, item) {
	const arr = item ? ops.map(({prop}) => {
		const val = get(item, prop, null);

		if (typeof val === 'undefined') {
			throw new Error(`Item is missing required property: '${prop}'`);
		}

		const handler = typeHandlers.find(h => h.test(val));

		return base64url(`${handlerPrefix(handler)}${JSON.stringify(val)}`);
	}) : [];
	return arr.join('.');
}

function deserializeCursor(ops, cursor = '') {
	const vals = cursor
		.split('.')
		.map(b64 => {
			if (b64) {
				const str = base64url.decode(b64);
				const matches = str.match(/#__cur_t:(.*)#(.*)/);
				const type = matches && matches[1];
				const value = JSON.parse(matches ? matches[2] : str);

				if (type) {
					return typeHandlers.find(h => h.name === type).deserialize(value);
				}

				return value;
			}

			return b64;
		});

	return cursor ?
		ops.reduce((acc, {prop}, i) => {
			set(acc, prop, vals[i]);
			return acc;
		}, {}) :
		null;
}

module.exports = {serializeCursor, deserializeCursor};
