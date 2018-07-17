# objection-cursor

An [Objection.js](https://vincit.github.io/objection.js) plugin for cursor based pagination.

Using offsets for pagination is a widely popular technique. Clients tell the number of results they want per page, and the page number they want to return results from. While easy to implement and use, offsets come with a drawback: when items are written to the database at a high frequency, offset based pagination becomes unreliable. For example, if we fetch a page with 10 rows, and then 10 rows are added, fetching the second page might contain the same rows as the first page.

Cursor based pagination works by returning a pointer to a row in the database. Fetching the next/previous page will then return items after/before the given pointer. While reliable, this technique comes with a few drawbacks itself:

- The cursor must be based on a unique column (or columns)
- The concept of pages is lost, and thus you cannot jump to a specific one

Cursor pagination is used by companies such as Twitter, Facebook and Slack, and goes well with infinite scroll elements in general.

# Installation

```
$ npm install objection-cursor
```

# Usage

#### Mixin

```js
const Model = require('objection').Model;
const cursorMixin = require('objection-cursor');

// Set options
const cursor = cursorMixin({limit: 10});

class Movie extends cursor(Model) {
  ...
}

// Options are not required
class Car extends cursorMixin(Model) {
  ...
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
      return query.clone().cursorPage(result.pageInfo.next);
    })
    .then(result => {
      // Rows 11-20
      console.log(result.results);
      return query.clone().previousCursorPage(result.pageInfo.previous);
    })
    .then(result => {
      // Rows 1-10
      console.log(result.results);
    });

```

Passing a [reference builder](https://vincit.github.io/objection.js/#referencebuilder) to `orderBy` is supported. [Raw queries](https://vincit.github.io/objection.js/#raw-queries), however, are not.

```js
const query = Movie.query()
  .joinEager('director')
  .orderBy(ref('director.name'))
  // Order by a JSON field of an eagerly joined relation
  .orderBy(ref('director.born:time').castText())
  .orderBy('id')
  ...
```

Cursors ordered by nullable columns won't work out-of-the-box. For this reason the mixin also introduces an `orderByCoalesce` method, which you can use to treat nulls as some other value for the sake of comparisons. Same as `orderBy`, `orderByCoalesce` supports reference builders, but not raw queries.

```js
const query = Movie.query()
  .orderByCoalesce('alt_title', 'asc', '') // Coalesce null values into empty string
  .orderByCoalesce('alt_title', 'asc') // Same as above
  .orderByCoalesce('alt_title', 'asc', [null, 'hello']) // First non-null value will be used
  .orderByCoalesce(ref('details:completed').castText(), 'desc') // Works with refs
   // Reference builders and raw queries can be coalesced to
  .orderByCoalesce('even_more_alt_title', 'asc', [ref('alt_title'), raw('?', '')])
  .orderBy('id')
  ...
```

# API

## `Plugin`

### `cursor(options | Model)`

You can setup the mixin with or without options.

Example (with options):

```js
const Model = require('objection').Model;
const cursorMixin = require('objection-cursor');

const cursor = cursorMixin({
  limit: 10,
  pageInfo: {
    total: true,
    hasNext: true
  }
});

class Movie extends cursor(Model) {
  ...
}

Movie.query()
  .orderBy('id')
  .cursorPage()
  .then(res => {
    console.log(res.results.length) // 10
    console.log(res.pageInfo.total) // Some number
    console.log(res.pageInfo.hasNext) // true

    console.log(res.pageInfo.remaining) // undefined
    console.log(res.pageInfo.hasPrevious) // undefined
  });
```

Example (without options):

```js
const Model = require('objection').Model;
const cursorMixin = require('objection-cursor');

class Movie extends cursorMixin(Model) {
  ...
}
```

## `CursorQueryBuilder`

### `cursorPage([cursor, [before]])`

- `cursor` - A URL-safe string used to determine after/before which element items should be returned.
- `before` - When `true`, return items before the one specified in the cursor. Use this to "go back".
  - Default: `false`.

**Response format:**

```js
{
  results: // Resulted rows.
  pageInfo: {
    next: // Provide this in the next `cursorPage` call to fetch items after the last ones.
    previous: // Provide this in the next `previousCursorPage` call to fetch items before the last ones.

    hasNext: // If `options.pageInfo.hasNext` is true.
    hasPrevious: // If `options.pageInfo.hasPrevious` is true.
    remaining: // If `options.pageInfo.remaining` is true. Number of items remaining (after or before `results`).
    total: // If `options.pageInfo.total` is true. Total number of rows (without limit).
  }
}
```

### `nextCursorPage([cursor])`

Alias for `cursorPage`, with `before: false`.

### `previousCursorPage([cursor])`

Alias for `cursorPage`, with `before: true`.

### `orderByCoalesce(column, [direction, [values]])`

Use this if you want to sort by a nullable column.

- `column` - Column to sort by.
- `direction` - Sort direction.
  - Default: `asc`
- `values` - Values to coalesce to. If column has a null value, treat it as the first non-null value in `values`. Can be one or many of: *string*, *ReferenceBuilder* or *RawQuery*.
  - Default: `['']`

# Options

Values shown are defaults.

```js
{
  limit: 50, // Default limit in all queries
  pageInfo: {
    // When true, these values will be added to `pageInfo` in query response
    total: false, // Total amount of rows
    remaining: false, // Remaining amount of rows in *this* direction
    hasNext: false, // Are there rows after current results?
    hasPrevious: false, // Are there rows before current results?
  }
}
```

**Notes:**

- `pageInfo.total` requires an additional query.
- `pageInfo.remaining` requires and additional query.
- `pageInfo.hasNext` requires the same queries as `pageInfo.total` and `pageInfo.remaining`.
- `pageInfo.hasPrevious` requires the same queries as `pageInfo.total` and `pageInfo.remaining`.