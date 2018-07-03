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
const query = Movie.query()
  // Strict ordering is required
  .orderBy('title')
  .orderBy('author')
  .limit(10);

  query.clone().cursorPage()
    .then(result => {
      // Rows 1-10
      console.log(result.results);
      console.log(result.pageInfo.total); // Total amount of rows (without limit)
      return query.clone().cursorPage(result.pageInfo.cursor);
    })
    .then(result => {
      // Rows 11-20
      console.log(result.results);
      return query.clone().previousCursorPage(result.pageInfo.cursor);
    })
    .then(result => {
      // Rows 1-10
      console.log(result.results);
    });

```

# API

### `cursorPage([cursor, [reverse]])`

- `cursor` - A serialized string used to determine after which element items should be returned.
- `reverse` - When `true`, return items before the one specified in the cursor. Defaults to `false`.

**Returns:**

```js
{
  results: // Resulted rows
  pageInfo: {
    cursor: // Use this string in the next `cursorPage` call
    total: // Total number of rows (without limit)
  }
}
```

### `nextCursorPage([cursor])`

Alias for `cursorPage`, with `reverse: false`.

### `previousCursorPage([cursor])`

Alias for `cursorPage`, with `reverse: true`.
