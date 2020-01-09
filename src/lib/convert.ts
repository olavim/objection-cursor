import {get, last, trim} from 'lodash';
import {Model, ReferenceBuilder, ColumnRef} from 'objection';

interface ParsedExpr {
	columnName: string;
	access: Array<{ref: string}>;
}

function stringToProperty<M extends typeof Model>(model: M, str: string) {
	const prop = str.substr(str.lastIndexOf('.') + 1);
	return (model as any).columnNameToPropertyName(prop) as string;
}

function refToProperty<M extends typeof Model>(model: M, ref: ReferenceBuilder) {
	// `parsedExpr` for Objection v2, `reference` for v0, v1
	const {columnName, access} = ((ref as any).parsedExpr || (ref as any).reference) as ParsedExpr;

	const columnPieces = columnName.split('.');
	columnPieces[columnPieces.length - 1] = (model as any).columnNameToPropertyName(last(columnPieces)) as string;

	const prop = `${columnPieces.join('.')}.${access.map(a => a.ref).join('.')}`;
	return trim(prop, '.');
}

export function columnToProperty<M extends typeof Model>(model: M, col: ColumnRef) {
	if (typeof col === 'string') {
		return stringToProperty(model, col);
	}

	if (get(col, 'constructor.name') === 'ReferenceBuilder') {
		return refToProperty(model, col as ReferenceBuilder);
	}

	throw new TypeError('orderBy column must be string or ReferenceBuilder');
}
