import Knex from 'knex';
import moment from 'moment';
import queryBuilderTests from './query-builder';
import optionsTests from './options';
import referenceTests from './ref';

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
			// Add some undefined values
			title: key % 10 === 0 ? null : `movie-${padStart(String(key % 15), 2, '0')}`,
			alt_title: `film-${padStart(String(key % 15), 2, '0')}`,
			author: `author-${key % 5}`,
			createdAt: new Date(d.getTime() + key).toISOString(),
			// Add some null values
			date: key % 3 === 0 ? null : new Date(d.getTime() + (key % 7)).toISOString()
		};
	});

	// Make some createdAt same
	arr[num - 1].createdAt = arr[num - 3].createdAt;
	arr[num - 2].createdAt = arr[num - 3].createdAt;

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
	}, {
		client: 'mysql',
		version: '5.7',
		connection: {
			host: '127.0.0.1',
			user: 'cursortest',
			database: 'objection-cursor-test'
		}
	}];

	const tasks = dbConnections
		.filter(config => !process.env.CLIENT || process.env.CLIENT === config.client)
		.map(config => {
			const knex = Knex(config);

			describe(config.client, () => {
				before(() => {
					return knex.schema.dropTableIfExists('movies');
				});

				before(() => {
					return knex.schema.dropTableIfExists('movie_refs');
				});

				before(() => {
					return knex.schema.createTable('movies', table => {
						table.increments();
						table.string('title');
						table.string('author');
						table.string('alt_title');

						if (config.client === 'mysql') {
							table.specificType('date', 'DATETIME(3)');
							table.specificType('createdAt', 'DATETIME(3)');
						} else {
							table.dateTime('date');
							table.dateTime('createdAt');
						}
					});
				});

				before(() => {
					return knex.schema.createTable('movie_refs', table => {
						table.increments();
						table.integer('movie_id');
						table.json('data');
					});
				});

				before(() => {
					const movies = generateMovies(20);

					if (config.client === 'mysql') {
						for (const movie of movies) {
							movie.date = movie.date && moment(movie.date).format('YYYY-MM-DD HH:mm:ss.SSS');
							movie.createdAt = moment(movie.createdAt).format('YYYY-MM-DD HH:mm:ss.SSS');
						}
					}

					return knex('movies').insert(movies);
				});

				queryBuilderTests(knex);
				optionsTests(knex);

				if (config.client === 'pg') {
					before(() => {
						return knex('movie_refs').insert(generateMovies(20).map((movie, id) => ({
							movie_id: id + 1,
							data: {title: movie.title}
						})));
					});

					referenceTests(knex);
				}
			});

			return knex;
		});

	after(() => {
		return Promise.all(tasks.map(knex => knex.destroy()));
	});
});
