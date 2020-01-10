import {merge} from 'lodash';
import {Model} from 'objection';
import mixin, {AnyConstructor, CursorMixin} from './mixin';
import {InputOptions, Options} from './query-builder';

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

	return mixin(options);
}

function cursor(options: InputOptions): <T extends AnyConstructor<Model>>(ModelClass: T) => CursorMixin<T>;
function cursor<T extends AnyConstructor<Model>>(ModelClass: T): CursorMixin<T>;

function cursor<T extends AnyConstructor<Model> = any>(options: InputOptions | T = {}) {
	if (typeof options === 'function') {
		return getMixin({})(options);
	}

	return getMixin(options);
}

export default cursor;
