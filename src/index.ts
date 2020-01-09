import {merge} from 'lodash';
import {Model} from 'objection';
import mixin, {Options, InputOptions, AnyConstructor, CursorModel} from './mixin';

function getMixin(inOptions: InputOptions) {
	const options = merge({
		limit: 50,
		pageInfo: {
			total: false,
			remaining: false,
			remainingBefore: false,
			remainingAfter: false,
			hasNext: false,
			hasPrevious: false
		}
	}, inOptions) as Options;

	return mixin(options) as <T extends AnyConstructor<Model>>(ModelClass: T) => T & CursorModel;
}

function cursor(options: InputOptions): <T extends AnyConstructor<Model>>(ModelClass: T) => T & CursorModel;
function cursor<T extends AnyConstructor<Model>>(ModelClass: T): T & CursorModel;

function cursor(options: InputOptions | typeof Model = {}) {
	if (typeof options === 'function') {
		return getMixin({})(options);
	}

	return getMixin(options);
}

export default cursor;
