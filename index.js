const {merge} = require('lodash');
const cursorSupport = require('./lib/query-builder/CursorQueryBuilder');

const cursorMixin = options => {
	options = merge({
		limit: 50,
		results: true,
		nodes: false,
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
		const CursorQueryBuilder = cursorSupport(options, Base.QueryBuilder);

		return class extends Base {
			static get QueryBuilder() {
				return CursorQueryBuilder;
			}
		};
	};
};

module.exports = (options = {}) => {
	if (typeof options === 'function') {
		return cursorMixin({})(options);
	}

	return cursorMixin(options);
};
