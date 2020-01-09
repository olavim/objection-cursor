import base64url from 'base64url';
import {set, get} from 'lodash';
import {serializeValue, deserializeString} from './type-serializer';

export function serializeCursor(ops: Array<{prop: string}>, item: any) {
	if (!item) {
		return '';
	}

	return ops
		.map(({prop}) => {
			const val = get(item, prop, null);
			return base64url(serializeValue(val));
		})
		.join('.');
}

export function deserializeCursor(ops: Array<{prop: string}>, cursor: string = '') {
	if (!cursor) {
		return null;
	}

	const vals = cursor
		.split('.')
		.map(b64 => b64 ? deserializeString(base64url.decode(b64)) : b64);

	return ops.reduce((acc, {prop}, i) => {
		set(acc, prop, vals[i]);
		return acc;
	}, {});
}
