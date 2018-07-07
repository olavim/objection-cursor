'use strict';

const Knex = require('knex');
const cursorTests = require('./cursor');
const optionsTests = require('./options');

function padStart(str, targetLength, padString) {
	let padded = str;
	while (padded.length < targetLength) {
		padded = padString + padded;
	}
	return padded;
}

const generateMovies = num => {
	const d = new Date(2000, 1, 1, 0, 0, 0, 0);
	const arr = [...new Array(num)].map((_val, key) => {
		return {
			title: `movie-${padStart(String(key % 15), 2, '0')}`,
			alt_title: `film-${padStart(String(key % 15), 2, '0')}`,
			author: `author-${key % 5}`,
			// Add some null values
			date: key % 3 === 0 ? null : new Date(d.getTime() + (key % 7)).toISOString()
		};
	});

	return arr;
};

describe('database tests', () => {
	const dbConnections = [{
		client: 'sqlite3',
		useNullAsDefault: true,
		connection: {
			filename: 'test.db'
		}
	}, {
		client: 'pg',
		connection: {
			host: '127.0.0.1',
			user: 'cursortest',
			database: 'objection-cursor-test'
		}
	}];

	const tasks = dbConnections.map(config => {
		const knex = Knex(config);

		describe(config.client, () => {
			before(() => {
				return knex.schema.dropTableIfExists('movies');
			});

			before(() => {
				return knex.schema.createTable('movies', table => {
					table.increments();
					table.string('title');
					table.string('author');
					table.dateTime('date');
					table.string('alt_title');
				});
			});

			before(() => {
				return knex('movies').insert(generateMovies(20));
			});

			cursorTests(knex);
			optionsTests(knex);
		});

		return knex;
	});

	after(() => {
		return Promise.all(tasks.map(knex => knex.destroy()));
	});
});
