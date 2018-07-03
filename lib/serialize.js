function serializeCursor(ops, first, last) {
	const arr = [];

	// If first exists, push 't', otherwise push 'f'. Same for last.
	arr.push(`${first ? 't' : 'f'}${last ? 't' : 'f'}`);

	for (const {col} of ops) {
		if (first) {
			arr.push(Buffer.from(JSON.stringify(first[col])).toString('base64'));
		}
		if (last) {
			arr.push(Buffer.from(JSON.stringify(last[col])).toString('base64'));
		}
	}

	return arr.join(':');
}

function deserializeCursor(ops, cursor) {
	const b64values = cursor.split(':');

	// `valueCheck` tells us if cursor contains data for first and/or last element
	const valueCheck = b64values.splice(0, 1)[0];
	const first = {};
	const last = {};

	for (let i = 0; i < b64values.length; i += 2) {
		const {col} = ops[i / 2];
		if (b64values[i]) {
			first[col] = JSON.parse(Buffer.from(b64values[i], 'base64').toString());
		}
		if (b64values[i + 1]) {
			last[col] = JSON.parse(Buffer.from(b64values[i + 1], 'base64').toString());
		}
	}

	return {
		first: valueCheck.charAt(0) === 't' ? first : null,
		last: valueCheck.charAt(1) === 't' ? last : null
	};
}

module.exports = {serializeCursor, deserializeCursor};
