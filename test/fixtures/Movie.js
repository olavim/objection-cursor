const Model = require('objection').Model;
const cursorPagination = require('../..');

module.exports = class extends cursorPagination(Model) {
	static get tableName() {
		return 'movies';
	}
};
