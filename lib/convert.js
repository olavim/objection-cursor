const {get, trim} = require('lodash');

function stringToProperty(str) {
	return str.substr(str.lastIndexOf('.') + 1);
}

function refToProperty(Model, ref) {
	const parsedExpr = ref.parsedExpr || ref.reference; // parsedExpr for Objection v2
	let {columnName, access, table} = parsedExpr;

	if (Model.tableName === table) {
		// Remove table name and the folowing dot from column name
		columnName = columnName.substring(table.length + 1);
	}

	const columnPieces = columnName.split('.');

	const prop = `${columnPieces.join('.')}.${access.map(a => a.ref).join('.')}`;
	return trim(prop, '.');
}

function columnToProperty(Model, col) {
	if (typeof col === 'string') {
		return stringToProperty(col);
	}

	if (get(col, 'constructor.name') === 'ReferenceBuilder') {
		return refToProperty(Model, col);
	}

	throw new TypeError('orderBy column must be string or ReferenceBuilder');
}

module.exports = {columnToProperty};
