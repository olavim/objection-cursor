function toBase64(val) {
	return Buffer.from(JSON.stringify(val)).toString('base64');
}

function fromBase64(str) {
	return JSON.parse(Buffer.from(str, 'base64').toString());
}

function serializeCursor(ops, first, last) {
	const arr = [];

	// If first exists, push 't', otherwise push 'f'. Same for last.
	arr.push(`${first ? 't' : 'f'}${last ? 't' : 'f'}`);

	for (const {col} of ops) {
		arr.push(first ? toBase64(first[col]) : '');
		arr.push(last ? toBase64(last[col]) : '');
	}

	return arr.join(':');
}

function deserializeCursor(ops, cursor = '') {
	const b64values = cursor.split(':');

	// `firstLast` tells us if cursor contains data for first and/or last element
	const firstLast = b64values.splice(0, 1)[0].split('').map(v => v === 't' ? {} : null);

	return b64values.reduce((acc, val, i) => {
		if (val) {
			acc[i % 2][ops[Math.floor(i / 2)].col] = fromBase64(val);
		}
		return acc;
	}, firstLast);
}

module.exports = {serializeCursor, deserializeCursor};
