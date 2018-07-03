# objection-cursor

An [Objection.js](https://vincit.github.io/objection.js) plugin for cursor based pagination.

Using offsets for pagination is a widely popular technique. Clients tell the number of results they want per page, and the page number they want to return results from. While easy to implement and use, offsets come with a drawback: when items are written to the database at a high frequency, offset based pagination becomes unreliable. For example, if we fetch a page with 10 rows, and then 10 rows are added, fetching the second page might contain the same rows as the first page.

Cursor based pagination works by returning a pointer to a row in the database. Fetching the next/previous page will then return items after/before the given pointer. While reliable, this technique comes with a few drawbacks itself:

- The cursor must be based on a unique column (or columns)
- The concept of pages is lost, and thus you cannot jump to a specific one

Cursor pagination is used by Twitter, Facebook and Slack, to name a few, and goes well with infinite scroll elements in general.

# Installation

```
$ npm install objection-cursor
```

# Usage

#### Mixin

```js
const Model = require('objection').Model;
const cursor = require('objection-cursor');

class Movie extends cursor(Model) {
  static get tableName() {
    return 'movies';
  }
}
```

#### Quick Start

```js
Movie.query()
  // Strict ordering is required
  .orderBy('title')
  .orderBy('author')
	.limit(10)

```