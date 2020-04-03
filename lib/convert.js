const {get, last, trim} = require('lodash');

function stringToProperty(str) {
	return str.substr(str.lastIndexOf('.') + 1);
}

function refToProperty(ref) {
	const parsedExpr = ref.parsedExpr || ref.reference; // parsedExpr for Objection v2
	let {columnName, access} = parsedExpr;

	const columnPieces = columnName.split('.');
	columnPieces[columnPieces.length - 1] = last(columnPieces);

	const prop = `${columnPieces.join('.')}.${access.map(a => a.ref).join('.')}`;
	return trim(prop, '.');
}

function columnToProperty(col) {
	if (typeof col === 'string') {
		return stringToProperty(col);
	}

	if (get(col, 'constructor.name') === 'ReferenceBuilder') {
		return refToProperty(col);
	}

	throw new TypeError('orderBy column must be string or ReferenceBuilder');
}

module.exports = {columnToProperty};
