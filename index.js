const {merge} = require('lodash');
const getQueryBuilder = require('./query-builder');

const mixin = options => {
	options = merge({
		limit: 50,
		pageInfo: {
			total: false,
			remaining: false,
			remainingBefore: false,
			remainingAfter: false,
			hasNext: false,
			hasPrevious: false
		}
	}, options);

	return Base => {
		const CursorQueryBuilder = getQueryBuilder(options, Base);

		return class extends Base {
			static get QueryBuilder() {
				return CursorQueryBuilder;
			}
		};
	}
}

module.exports = (options = {}) => {
	if (typeof options === 'function') {
		return mixin({})(options);
	}

	return mixin(options);
};
