const {get, last, trim} = require('lodash');

function stringToProperty(model, str) {
	const prop = str.substr(str.lastIndexOf('.') + 1);
	return model.columnNameToPropertyName(prop);
}

function refToProperty(model, ref) {
	const parsedExpr = ref.parsedExpr || ref.reference; // parsedExpr for Objection v2
	let {columnName, access} = parsedExpr;

	const columnPieces = columnName.split('.');
	columnPieces[columnPieces.length - 1] = model.columnNameToPropertyName(last(columnPieces));

	const prop = `${columnPieces.join('.')}.${access.map(a => a.ref).join('.')}`;
	return trim(prop, '.');
}

function columnToProperty(model, col) {
	if (typeof col === 'string') {
		return stringToProperty(model, col);
	}

	if (get(col, 'constructor.name') === 'ReferenceBuilder') {
		return refToProperty(model, col);
	}

	throw new TypeError('orderBy column must be string or ReferenceBuilder');
}

module.exports = {columnToProperty};
