module.exports = function (Base) {
	return class extends Base.QueryBuilder {
		$flag(key, value) {
			return this._setContext(key, value, '__cursor_flag_');
		}

		$data(key, value) {
			return this._setContext(key, value, '__cursor_data_');
		}

		_setContext(key, value, prefix) {
			key = `${prefix}${key}`;

			if (value !== undefined) {
				return this.mergeContext({[key]: value});
			}

			return this.context()[key];
		}
	}
}
